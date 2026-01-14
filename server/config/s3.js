// s3 file storage
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, '..', '.env') });

// grab aws creds from env
const AWS_REGION = (process.env.AWS_REGION || 'us-east-2').trim();
const AWS_ACCESS_KEY_ID = (process.env.AWS_ACCESS_KEY_ID || '').trim();
const AWS_SECRET_ACCESS_KEY = (process.env.AWS_SECRET_ACCESS_KEY || '').trim();
const BUCKET_NAME = (process.env.AWS_S3_BUCKET_NAME || '').trim();

// log config but hide the secret
console.log('\n=== S3 Configuration ===');
console.log('  Region:', AWS_REGION);
console.log('  Bucket:', BUCKET_NAME || '❌ NOT SET');
console.log('  Access Key ID:', AWS_ACCESS_KEY_ID ? `${AWS_ACCESS_KEY_ID.substring(0, 8)}...` : '❌ NOT SET');
console.log('  Secret Key:', AWS_SECRET_ACCESS_KEY ? '✓ SET (' + AWS_SECRET_ACCESS_KEY.length + ' chars)' : '❌ NOT SET');

// only init s3 if we have creds
let s3Client = null;
if (AWS_ACCESS_KEY_ID && AWS_SECRET_ACCESS_KEY && BUCKET_NAME) {
  try {
    s3Client = new S3Client({
      region: AWS_REGION,
      credentials: {
        accessKeyId: AWS_ACCESS_KEY_ID,
        secretAccessKey: AWS_SECRET_ACCESS_KEY,
      },
    });
    console.log('✓ S3 client initialized successfully\n');
  } catch (error) {
    console.error('❌ Failed to initialize S3 client:', error.message);
  }
} else {
  console.warn('⚠️  S3 client NOT initialized - missing credentials or bucket name\n');
}

// upload parquet to s3
export async function uploadParquetToS3(parquetBuffer, cognitoSub, dsGroupId, commitId) {
  if (!s3Client) {
    throw new Error('S3 client not initialized. Check AWS credentials and bucket name in .env file.');
  }

  if (!BUCKET_NAME) {
    throw new Error('AWS_S3_BUCKET_NAME is not configured in environment variables');
  }

  if (!parquetBuffer || parquetBuffer.length === 0) {
    throw new Error('Parquet buffer is empty or invalid');
  }

  const s3Key = `tenants/${cognitoSub}/projects/${dsGroupId}/commits/${commitId}/data.parquet`;

  console.log('\n=== S3 Upload Attempt ===');
  console.log('  Bucket:', BUCKET_NAME);
  console.log('  Key:', s3Key);
  console.log('  File size:', parquetBuffer.length, 'bytes');
  console.log('  Cognito Sub:', cognitoSub);
  console.log('  DS Group ID:', dsGroupId);
  console.log('  Commit ID:', commitId);

  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: s3Key,
    Body: parquetBuffer,
    ContentType: 'application/octet-stream',
  });

  try {
    const result = await s3Client.send(command);
    console.log('✓ Parquet file uploaded to S3 successfully!');
    console.log('  S3 Key:', s3Key);
    console.log('  ETag:', result.ETag);
    console.log('  Full S3 path: s3://' + BUCKET_NAME + '/' + s3Key);
    console.log('=======================\n');
    return s3Key;
  } catch (error) {
    console.error('\n❌ S3 Upload Error:');
    console.error('  Error name:', error.name);
    console.error('  Error message:', error.message);
    console.error('  Error code:', error.code || 'N/A');
    if (error.$metadata) {
      console.error('  HTTP status:', error.$metadata.httpStatusCode);
      console.error('  Request ID:', error.$metadata.requestId);
    }
    if (error.stack) {
      console.error('  Stack:', error.stack);
    }
    console.error('=======================\n');
    throw error;
  }
}

// download parquet from s3
export async function downloadParquetFromS3(cognitoSub, dsGroupId, commitId) {
  if (!s3Client) {
    throw new Error('S3 client not initialized. Check AWS credentials and bucket name in .env file.');
  }

  if (!BUCKET_NAME) {
    throw new Error('AWS_S3_BUCKET_NAME is not configured in environment variables');
  }

  const s3Key = `tenants/${cognitoSub}/projects/${dsGroupId}/commits/${commitId}/data.parquet`;

  console.log('\n=== S3 Download Attempt ===');
  console.log('  Bucket:', BUCKET_NAME);
  console.log('  Key:', s3Key);

  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: s3Key,
  });

  try {
    const response = await s3Client.send(command);
    const chunks = [];
    
    // read chunks and combine into buffer
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }
    
    const buffer = Buffer.concat(chunks);
    console.log('✓ Parquet file downloaded from S3 successfully!');
    console.log('  File size:', buffer.length, 'bytes');
    console.log('=======================\n');
    return buffer;
  } catch (error) {
    console.error('\n❌ S3 Download Error:');
    console.error('  Error name:', error.name);
    console.error('  Error message:', error.message);
    console.error('  Error code:', error.code || 'N/A');
    if (error.$metadata) {
      console.error('  HTTP status:', error.$metadata.httpStatusCode);
      console.error('  Request ID:', error.$metadata.requestId);
    }
    console.error('=======================\n');
    throw error;
  }
}

// get a stream from s3 if you need it
export async function getParquetStreamFromS3(cognitoSub, dsGroupId, commitId) {
  if (!s3Client) {
    throw new Error('S3 client not initialized. Check AWS credentials and bucket name in .env file.');
  }

  if (!BUCKET_NAME) {
    throw new Error('AWS_S3_BUCKET_NAME is not configured in environment variables');
  }

  const s3Key = `tenants/${cognitoSub}/projects/${dsGroupId}/commits/${commitId}/data.parquet`;

  console.log('\n=== S3 Stream Request ===');
  console.log('  Bucket:', BUCKET_NAME);
  console.log('  Key:', s3Key);

  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: s3Key,
  });

  try {
    const response = await s3Client.send(command);
    console.log('✓ Parquet stream obtained from S3');
    console.log('=======================\n');
    return response.Body; // returns a stream
  } catch (error) {
    console.error('\n❌ S3 Stream Error:');
    console.error('  Error name:', error.name);
    console.error('  Error message:', error.message);
    console.error('  Error code:', error.code || 'N/A');
    throw error;
  }
}

// delete all project files from s3
export async function deleteProjectFromS3(cognitoSub, dsGroupId) {
  if (!s3Client) {
    throw new Error('S3 client not initialized. Check AWS credentials and bucket name in .env file.');
  }

  if (!BUCKET_NAME) {
    throw new Error('AWS_S3_BUCKET_NAME is not configured in environment variables');
  }

  const prefix = `tenants/${cognitoSub}/projects/${dsGroupId}/`;

  console.log('\n=== S3 Project Deletion ===');
  console.log('  Bucket:', BUCKET_NAME);
  console.log('  Prefix:', prefix);

  try {
    // list all files to delete
    const listCommand = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: prefix,
    });

    const listResponse = await s3Client.send(listCommand);
    
    if (!listResponse.Contents || listResponse.Contents.length === 0) {
      console.log('  No objects found to delete');
      console.log('=======================\n');
      return 0;
    }

    // s3 limits to 1000 deletes at once, so batch it
    const objectsToDelete = listResponse.Contents.map(obj => ({ Key: obj.Key }));
    
    let deletedCount = 0;
    // delete in batches of 1000
    for (let i = 0; i < objectsToDelete.length; i += 1000) {
      const batch = objectsToDelete.slice(i, i + 1000);
      const deleteCommand = new DeleteObjectsCommand({
        Bucket: BUCKET_NAME,
        Delete: {
          Objects: batch,
          Quiet: false,
        },
      });

      const deleteResponse = await s3Client.send(deleteCommand);
      deletedCount += deleteResponse.Deleted?.length || 0;
    }

    console.log(`✓ Deleted ${deletedCount} objects from S3`);
    console.log('=======================\n');
    return deletedCount;
  } catch (error) {
    console.error('\n❌ S3 Deletion Error:');
    console.error('  Error name:', error.name);
    console.error('  Error message:', error.message);
    console.error('  Error code:', error.code || 'N/A');
    if (error.$metadata) {
      console.error('  HTTP status:', error.$metadata.httpStatusCode);
      console.error('  Request ID:', error.$metadata.requestId);
    }
    console.error('=======================\n');
    throw error;
  }
}

export { s3Client, BUCKET_NAME };

