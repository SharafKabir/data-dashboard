// handling csv data stuff
import express from 'express';
import { query } from '../config/database.js';
import { uploadParquetToS3, downloadParquetFromS3, deleteProjectFromS3 } from '../config/s3.js';
import parquet from 'parquetjs';
import { readFile, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

const router = express.Router();

// save the csv they sent us
router.post('/save', async (req, res) => {
  try {
    console.log('Dataset save request received');
    console.log('Session user:', req.session.user);
    
    // check if they're actually logged in
    if (!req.session.user || !req.session.user.sub) {
      console.log('Authentication check failed');
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { projectName, csvData } = req.body;
    const cognitoSub = req.session.user.sub;

    console.log('Request data:', { projectName, hasCsvData: !!csvData, cognitoSub });

    if (!projectName || !csvData) {
      return res.status(400).json({ error: 'Project name and CSV data are required' });
    }

    // see if they exist in db, need this for foreign key stuff
    const userCheck = await query(
      'SELECT cognito_sub FROM users WHERE cognito_sub = $1',
      [cognitoSub]
    );

    if (userCheck.rows.length === 0) {
      console.log('User not found in database, inserting...');
      // probably not in db yet, just add them
      const userEmail = req.session.user.email || 'unknown@example.com';
      await query(
        'INSERT INTO users (cognito_sub, email) VALUES ($1, $2) ON CONFLICT (cognito_sub) DO NOTHING',
        [cognitoSub, userEmail]
      );
    }

    // create new dataset thing, db gives us the ids automatically
    console.log('Inserting into dataset table...');
    const datasetResult = await query(
      `INSERT INTO dataset (cognito_sub) 
       VALUES ($1) 
       RETURNING ds_group_id, commit_id`,
      [cognitoSub]
    );

    if (datasetResult.rows.length === 0) {
      console.error('Failed to create dataset entry - no rows returned');
      return res.status(500).json({ error: 'Failed to create dataset entry' });
    }

    const { ds_group_id, commit_id } = datasetResult.rows[0];
    console.log('Dataset created:', { ds_group_id, commit_id });

    // convert csv to parquet cause it's smaller
    console.log('Converting CSV to Parquet...');
    let parquetBuffer;
    try {
      parquetBuffer = await convertCsvToParquet(csvData);
      console.log(`✓ Parquet file created (${parquetBuffer.length} bytes)`);
    } catch (parquetError) {
      console.error('Error converting CSV to Parquet:', parquetError);
      // whatever, just keep going if this breaks
    }

    // throw it up to s3
    let s3Key = null;
    if (parquetBuffer) {
      console.log('Attempting S3 upload...');
      console.log('  Parquet buffer size:', parquetBuffer.length, 'bytes');
      try {
        s3Key = await uploadParquetToS3(parquetBuffer, cognitoSub, ds_group_id, commit_id);
        console.log(`✓ File uploaded to S3: ${s3Key}`);
      } catch (s3Error) {
        console.error('❌ Error uploading to S3:', s3Error);
        console.error('  Error details:', {
          name: s3Error.name,
          message: s3Error.message,
          code: s3Error.code,
        });
        // s3 might be down but whatever
      }
    } else {
      console.warn('⚠️  Skipping S3 upload - Parquet buffer is empty or conversion failed');
    }

    // store what they named it
    console.log('Inserting into names table...');
    try {
      await query(
        `INSERT INTO names (name, ds_group_id, root_commit_id, cognito_sub) 
         VALUES ($1, $2, $3, $4) 
         ON CONFLICT (ds_group_id, root_commit_id) 
         DO UPDATE SET name = EXCLUDED.name`,
        [projectName, ds_group_id, commit_id, cognitoSub]
      );
      console.log('Names entry created successfully');
    } catch (error) {
      // oh they used a name that's taken already
      if (error.code === '23505' && error.constraint === 'names_cognito_sub_name_unique') {
        console.error('Duplicate project name detected');
        return res.status(409).json({ 
          error: 'Project name already exists', 
          details: `A project with the name "${projectName}" already exists. Please choose a different name.`,
          code: 'DUPLICATE_PROJECT_NAME'
        });
      }
      // something else went wrong
      throw error;
    }

    // stash this in session for later
    req.session.currentDataset = {
      ds_group_id,
      commit_id,
      projectName,
      s3Key
    };

    res.json({ 
      success: true, 
      ds_group_id, 
      commit_id,
      s3Key,
      message: 'CSV data saved successfully' 
    });
  } catch (error) {
    console.error('Error saving CSV data:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ error: 'Failed to save CSV data', details: error.message });
  }
});

// grab all their datasets
router.get('/list', async (req, res) => {
  try {
    if (!req.session.user || !req.session.user.sub) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const cognitoSub = req.session.user.sub;

    // get all their stuff with the names attached
    const result = await query(
      `SELECT DISTINCT d.ds_group_id, d.commit_id, n.name, d.cognito_sub
       FROM dataset d
       LEFT JOIN names n ON d.ds_group_id = n.ds_group_id AND d.commit_id = n.root_commit_id
       WHERE d.cognito_sub = $1
       ORDER BY d.commit_id DESC`,
      [cognitoSub]
    );

    res.json({ success: true, datasets: result.rows });
  } catch (error) {
    console.error('Error fetching datasets:', error);
    res.status(500).json({ error: 'Failed to fetch datasets', details: error.message });
  }
});

// list all their project names
router.get('/projects', async (req, res) => {
  try {
    if (!req.session.user || !req.session.user.sub) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const cognitoSub = req.session.user.sub;

    // just the main projects, skip all the version history
    const result = await query(
      `SELECT DISTINCT n.name, n.ds_group_id, n.root_commit_id
       FROM names n
       INNER JOIN dataset d ON n.ds_group_id = d.ds_group_id AND n.root_commit_id = d.commit_id
       WHERE d.cognito_sub = $1
         AND d.parent_ds_group_id IS NULL
         AND d.parent_commit_id IS NULL
       ORDER BY n.name`,
      [cognitoSub]
    );

    res.json({ success: true, projects: result.rows });
  } catch (error) {
    console.error('Error fetching projects:', error);
    res.status(500).json({ error: 'Failed to fetch projects', details: error.message });
  }
});

// get the first version they uploaded
router.get('/project/:dsGroupId/root', async (req, res) => {
  try {
    if (!req.session.user || !req.session.user.sub) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const cognitoSub = req.session.user.sub;
    const { dsGroupId } = req.params;

    // find the original one that has no parent
    const result = await query(
      `SELECT ds_group_id, commit_id, cognito_sub
       FROM dataset
       WHERE ds_group_id = $1
         AND cognito_sub = $2
         AND parent_ds_group_id IS NULL
         AND parent_commit_id IS NULL
       LIMIT 1`,
      [dsGroupId, cognitoSub]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Root dataset not found for this project' });
    }

    const { commit_id } = result.rows[0];

    // download it from s3
    console.log(`Downloading Parquet file for project ${dsGroupId}, commit ${commit_id}...`);
    try {
      const parquetBuffer = await downloadParquetFromS3(cognitoSub, dsGroupId, commit_id);

      // convert back to csv so frontend can use it
      console.log('Converting Parquet to CSV...');
      const csvData = await convertParquetToCsv(parquetBuffer);

      res.json({ 
        success: true, 
        csvData: {
          headers: csvData.headers,
          rows: csvData.rows
        }
      });
    } catch (s3Error) {
      // file probably doesn't exist
      if (s3Error.name === 'NoSuchKey' || s3Error.Code === 'NoSuchKey') {
        console.error('S3 file not found for this project. The file may not have been uploaded successfully.');
        return res.status(404).json({ 
          error: 'Dataset file not found', 
          details: 'The data file for this project does not exist in storage. This may happen if the file upload failed or was deleted. Please try uploading the project again.',
          code: 'FILE_NOT_FOUND'
        });
      }
      // something else went wrong
      throw s3Error;
    }
  } catch (error) {
    console.error('Error fetching root dataset:', error);
    const statusCode = error.name === 'NoSuchKey' || error.Code === 'NoSuchKey' ? 404 : 500;
    res.status(statusCode).json({ 
      error: 'Failed to fetch root dataset', 
      details: error.message,
      code: error.name || error.Code
    });
  }
});

// delete everything, all versions gone
router.delete('/project/:dsGroupId', async (req, res) => {
  try {
    if (!req.session.user || !req.session.user.sub) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const cognitoSub = req.session.user.sub;
    const { dsGroupId } = req.params;

    // double check it's actually theirs
    const projectCheck = await query(
      `SELECT ds_group_id FROM dataset 
       WHERE ds_group_id = $1 AND cognito_sub = $2 
       LIMIT 1`,
      [dsGroupId, cognitoSub]
    );

    if (projectCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Project not found or access denied' });
    }

    // remove files from s3
    console.log(`Deleting S3 files for project ${dsGroupId}...`);
    let s3DeletedCount = 0;
    try {
      s3DeletedCount = await deleteProjectFromS3(cognitoSub, dsGroupId);
    } catch (s3Error) {
      console.error('Error deleting S3 files:', s3Error);
      // s3 might fail but keep deleting from db anyway
    }

    // remove the name entry
    console.log('Deleting from names table...');
    await query(
      `DELETE FROM names WHERE ds_group_id = $1`,
      [dsGroupId]
    );

    // delete from dataset table, cascades to everything else
    console.log('Deleting from dataset table...');
    await query(
      `DELETE FROM dataset WHERE ds_group_id = $1 AND cognito_sub = $2`,
      [dsGroupId, cognitoSub]
    );

    console.log(`✓ Project ${dsGroupId} deleted successfully`);
    res.json({ 
      success: true, 
      message: 'Project deleted successfully',
      s3FilesDeleted: s3DeletedCount
    });
  } catch (error) {
    console.error('Error deleting project:', error);
    res.status(500).json({ error: 'Failed to delete project', details: error.message });
  }
});

// convert parquet file back to csv format
async function convertParquetToCsv(parquetBuffer) {
  // gotta write to temp file first, parquet library needs it
  const tempFilePath = join(tmpdir(), `parquet-${randomUUID()}.parquet`);
  
  try {
    await writeFile(tempFilePath, parquetBuffer);
    
    // open up the parquet file
    const reader = await parquet.ParquetReader.openFile(tempFilePath);
    const cursor = reader.getCursor();
    
    // peek at first row to figure out columns
    const firstRecord = await cursor.next();
    if (!firstRecord) {
      throw new Error('Parquet file is empty');
    }
    
    // column names become our headers
    const headers = Object.keys(firstRecord);
    const headerCount = headers.length;
    
    // build array to hold all rows
    const rows = [];
    // stick first row in there
    const firstRow = new Array(headerCount);
    for (let i = 0; i < headerCount; i++) {
      const value = firstRecord[headers[i]];
      firstRow[i] = value !== null && value !== undefined ? String(value) : '';
    }
    rows.push(firstRow);
    
    // read rest in chunks so we don't crash from memory
    const BATCH_SIZE = 1000;
    let batch = [];
    let record;
    
    while ((record = await cursor.next())) {
      const row = new Array(headerCount);
      for (let i = 0; i < headerCount; i++) {
        const value = record[headers[i]];
        row[i] = value !== null && value !== undefined ? String(value) : '';
      }
      batch.push(row);
      
      // batch is full, dump it all in
      if (batch.length >= BATCH_SIZE) {
        rows.push(...batch);
        batch = [];
      }
    }
    
    // add the leftover rows
    if (batch.length > 0) {
      rows.push(...batch);
    }
    
    await reader.close();
    
    // clean up temp file
    await unlink(tempFilePath).catch(err => {
      console.warn('Failed to delete temporary file:', tempFilePath, err);
    });
    
    return { headers, rows };
  } catch (error) {
    // try to delete temp file even if we errored
    await unlink(tempFilePath).catch(() => {
      // don't care if cleanup fails
    });
    throw error;
  }
}

// convert csv to parquet, makes files way smaller
async function convertCsvToParquet(csvData) {
  const { headers, rows } = csvData;

  if (!headers || !rows || headers.length === 0) {
    throw new Error('Invalid CSV data: headers and rows are required');
  }

  // figure out schema from headers, just make everything strings for now
  // could be smarter and detect types but this works fine
  const schemaFields = {};
  // cache the cleaned headers so we don't process them twice
  const cleanedHeaders = [];
  const headerToCleanMap = new Map();
  
  headers.forEach((header, index) => {
    // clean up header name, parquet hates special chars
    const cleanHeader = header.trim().replace(/[^a-zA-Z0-9_]/g, '_');
    // make sure it's not empty after cleaning
    if (cleanHeader) {
      schemaFields[cleanHeader] = { type: 'UTF8' };
      cleanedHeaders.push(cleanHeader);
      headerToCleanMap.set(index, cleanHeader);
    } else {
      cleanedHeaders.push(null); // skip invalid ones
    }
  });

  if (Object.keys(schemaFields).length === 0) {
    throw new Error('No valid headers found after cleaning');
  }

  const schema = new parquet.ParquetSchema(schemaFields);

  // make a temp file path
  const tempFilePath = join(tmpdir(), `parquet-${randomUUID()}.parquet`);

  try {
    // create parquet writer
    const writer = await parquet.ParquetWriter.openFile(schema, tempFilePath);

    // write rows in batches so we don't run out of memory
    const BATCH_SIZE = 1000;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, Math.min(i + BATCH_SIZE, rows.length));
      
      // process this batch
      for (const row of batch) {
        const rowObject = {};
        // use the cached header map for speed
        headerToCleanMap.forEach((cleanHeader, originalIndex) => {
          rowObject[cleanHeader] = row[originalIndex] || '';
        });
        await writer.appendRow(rowObject);
      }
    }

    // close writer, this finishes the file
    await writer.close();

    // read the whole file into memory
    const buffer = await readFile(tempFilePath);

    // Clean up temporary file
    await unlink(tempFilePath).catch(err => {
      console.warn('Failed to delete temporary file:', tempFilePath, err);
    });

    return buffer;
  } catch (error) {
    // try to delete temp file if we errored
    await unlink(tempFilePath).catch(() => {
      // cleanup errors don't matter
    });
    throw error;
  }
}

// save a new version when they modify stuff
router.post('/save-version', async (req, res) => {
  try {
    console.log('Save version request received');
    console.log('Session user:', req.session.user);
    
    // make sure they're logged in
    if (!req.session.user || !req.session.user.sub) {
      console.log('Authentication check failed');
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { dsGroupId, parentCommitId, csvData, modifications } = req.body;
    const cognitoSub = req.session.user.sub;

    console.log('Request data:', { dsGroupId, parentCommitId, hasCsvData: !!csvData, modificationsCount: modifications?.length || 0, cognitoSub });

    if (!dsGroupId || !parentCommitId || !csvData) {
      return res.status(400).json({ error: 'dsGroupId, parentCommitId, and CSV data are required' });
    }

    // check that modifications array is valid
    if (!modifications || !Array.isArray(modifications) || modifications.length === 0) {
      return res.status(400).json({ error: 'modifications array is required and must not be empty' });
    }

    // check if user is in db
    const userCheck = await query(
      'SELECT cognito_sub FROM users WHERE cognito_sub = $1',
      [cognitoSub]
    );

    if (userCheck.rows.length === 0) {
      console.log('User not found in database, inserting...');
      const userEmail = req.session.user.email || 'unknown@example.com';
      await query(
        'INSERT INTO users (cognito_sub, email) VALUES ($1, $2) ON CONFLICT (cognito_sub) DO NOTHING',
        [cognitoSub, userEmail]
      );
    }

    // make sure parent exists and it's actually theirs
    const parentCheck = await query(
      'SELECT ds_group_id, commit_id, cognito_sub FROM dataset WHERE ds_group_id = $1 AND commit_id = $2',
      [dsGroupId, parentCommitId]
    );

    if (parentCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Parent dataset not found' });
    }

    if (parentCheck.rows[0].cognito_sub !== cognitoSub) {
      return res.status(403).json({ error: 'Unauthorized: Parent dataset does not belong to user' });
    }

    // insert new version, keep same ds_group_id since it's the same project
    console.log('Inserting new version into dataset table...');
    const datasetResult = await query(
      `INSERT INTO dataset (ds_group_id, cognito_sub, parent_ds_group_id, parent_commit_id) 
       VALUES ($1, $2, $3, $4) 
       RETURNING ds_group_id, commit_id`,
      [dsGroupId, cognitoSub, dsGroupId, parentCommitId]
    );

    if (datasetResult.rows.length === 0) {
      console.error('Failed to create dataset entry - no rows returned');
      return res.status(500).json({ error: 'Failed to create dataset entry' });
    }

    const { ds_group_id, commit_id } = datasetResult.rows[0];
    console.log('New dataset version created:', { ds_group_id, commit_id });

    // save all the modifications they made, in order
    console.log('Inserting modifications into modifications table...');
    if (modifications && modifications.length > 0) {
      for (let i = 0; i < modifications.length; i++) {
        const modification = modifications[i];
        const order = i + 1; // Order starts at 1
        const description = typeof modification === 'string' ? modification : modification.description || modification;
        
        // cut it off at 255 chars cause that's the db limit
        const truncatedDescription = description.length > 255 ? description.substring(0, 252) + '...' : description;
        
        await query(
          `INSERT INTO modifications (commit_id, parent_commit_id, order_num, description) 
           VALUES ($1, $2, $3, $4)`,
          [commit_id, parentCommitId, order, truncatedDescription]
        );
      }
      console.log(`✓ Inserted ${modifications.length} modification(s) into modifications table`);
    }

    // convert csv to parquet
    console.log('Converting CSV to Parquet...');
    console.log('CSV data received:', {
      headersCount: csvData.headers?.length || 0,
      rowsCount: csvData.rows?.length || 0,
      firstRowSample: csvData.rows?.length > 0 ? csvData.rows[0]?.slice(0, 3) : 'no rows'
    });
    let parquetBuffer;
    try {
      parquetBuffer = await convertCsvToParquet(csvData);
      console.log(`✓ Parquet file created (${parquetBuffer.length} bytes)`);
    } catch (parquetError) {
      console.error('Error converting CSV to Parquet:', parquetError);
      return res.status(500).json({ error: 'Failed to convert CSV to Parquet', details: parquetError.message });
    }

    // upload to s3
    console.log('Attempting S3 upload...');
    console.log('  Parquet buffer size:', parquetBuffer.length, 'bytes');
    let s3Key = null;
    try {
      s3Key = await uploadParquetToS3(parquetBuffer, cognitoSub, ds_group_id, commit_id);
      console.log(`✓ File uploaded to S3: ${s3Key}`);
    } catch (s3Error) {
      console.error('❌ Error uploading to S3:', s3Error);
      return res.status(500).json({ error: 'Failed to upload to S3', details: s3Error.message });
    }

    res.json({ 
      success: true, 
      ds_group_id, 
      commit_id,
      s3Key,
      message: 'Project version saved successfully' 
    });
  } catch (error) {
    console.error('Error saving project version:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ error: 'Failed to save project version', details: error.message });
  }
});

// get all the commits for a project
router.get('/project/:dsGroupId/commits', async (req, res) => {
  try {
    if (!req.session.user || !req.session.user.sub) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { dsGroupId } = req.params;
    const cognitoSub = req.session.user.sub;

    console.log(`Fetching all commits for project ${dsGroupId}`);

    // grab all commits
    const result = await query(
      `SELECT commit_id, parent_commit_id, parent_ds_group_id
       FROM dataset
       WHERE ds_group_id = $1 AND cognito_sub = $2
       ORDER BY commit_id`,
      [dsGroupId, cognitoSub]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No commits found for this project' });
    }

    res.json({
      success: true,
      commits: result.rows
    });
  } catch (error) {
    console.error('Error fetching commits:', error);
    res.status(500).json({ error: 'Failed to fetch commits', details: error.message });
  }
});

// get what changed in this commit
router.get('/commit/:commitId/modifications', async (req, res) => {
  try {
    if (!req.session.user || !req.session.user.sub) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { commitId } = req.params;
    const cognitoSub = req.session.user.sub;

    console.log(`Fetching modifications for commit ${commitId}`);

    // Verify the commit belongs to the user
    const commitCheck = await query(
      'SELECT cognito_sub FROM dataset WHERE commit_id = $1',
      [commitId]
    );

    if (commitCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Commit not found' });
    }

    if (commitCheck.rows[0].cognito_sub !== cognitoSub) {
      return res.status(403).json({ error: 'Forbidden: Commit does not belong to user' });
    }

    // get the modifications in order
    const result = await query(
      `SELECT order_num, description
       FROM modifications
       WHERE commit_id = $1
       ORDER BY order_num ASC`,
      [commitId]
    );

    res.json({
      success: true,
      modifications: result.rows
    });
  } catch (error) {
    console.error('Error fetching modifications:', error);
    res.status(500).json({ error: 'Failed to fetch modifications', details: error.message });
  }
});

// get the data for a specific commit
router.get('/project/:dsGroupId/commit/:commitId', async (req, res) => {
  try {
    if (!req.session.user || !req.session.user.sub) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { dsGroupId, commitId } = req.params;
    const cognitoSub = req.session.user.sub;

    console.log(`Fetching commit ${commitId} for project ${dsGroupId}`);

    // check it's theirs and matches the project
    const commitCheck = await query(
      'SELECT commit_id, cognito_sub FROM dataset WHERE ds_group_id = $1 AND commit_id = $2',
      [dsGroupId, commitId]
    );

    if (commitCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Commit not found' });
    }

    if (commitCheck.rows[0].cognito_sub !== cognitoSub) {
      return res.status(403).json({ error: 'Forbidden: Commit does not belong to user' });
    }

    // download from s3
    let csvData;
    try {
      const parquetBuffer = await downloadParquetFromS3(cognitoSub, dsGroupId, commitId);
      csvData = await convertParquetToCsv(parquetBuffer);
      console.log(`✓ Converted Parquet to CSV: ${csvData.headers.length} columns, ${csvData.rows.length} rows`);
    } catch (s3Error) {
      if (s3Error.name === 'NoSuchKey') {
        return res.status(404).json({ 
          error: 'File not found in S3',
          message: 'The Parquet file for this commit does not exist in S3. The project may need to be re-uploaded.'
        });
      }
      throw s3Error;
    }

    res.json({
      success: true,
      csvData
    });
  } catch (error) {
    console.error('Error fetching commit:', error);
    res.status(500).json({ error: 'Failed to fetch commit', details: error.message });
  }
});

export default router;

