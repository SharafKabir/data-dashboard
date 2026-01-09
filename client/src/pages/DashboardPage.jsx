import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import './DashboardPage.css';

function DashboardPage() {
  const [csvData, setCsvData] = useState(null);
  const [csvHeaders, setCsvHeaders] = useState([]);
  const [csvRows, setCsvRows] = useState([]);
  const [projectName, setProjectName] = useState('');
  const [showNamePrompt, setShowNamePrompt] = useState(false);
  const [columnWidths, setColumnWidths] = useState({});
  const [rowHeights, setRowHeights] = useState({});
  const [resizing, setResizing] = useState({ type: null, index: null, startX: null, startY: null, startWidth: null, startHeight: null });
  const tableRef = useRef(null);
  const tableWrapperRef = useRef(null);
  const previousCsvRowsLengthRef = useRef(0);
  const previousProjectRef = useRef(null);
  const isResettingProjectRef = useRef(false); // Flag to prevent scroll handler from overriding reset
  const navigate = useNavigate();
  const location = useLocation();
  
  // Virtual scrolling state
  const [scrollTop, setScrollTop] = useState(0);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 50 });
  
  // New state for project selection
  const [viewMode, setViewMode] = useState('initial'); // 'initial', 'select-project', 'upload', 'display'
  const [projects, setProjects] = useState([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingDataset, setLoadingDataset] = useState(false);
  const [selectedProject, setSelectedProject] = useState(null);
  const [currentCommitId, setCurrentCommitId] = useState(null); // Track the current commit being viewed (may differ from root_commit_id)
  const [previousViewMode, setPreviousViewMode] = useState(null); // Track where we came from
  
  // Operation modal state
  const [operationModal, setOperationModal] = useState(null); // null or { type: 'operationType', data: {} }
  const [operationInputs, setOperationInputs] = useState({});
  
  // Alert/Confirm modal state
  const [alertModal, setAlertModal] = useState(null); // null or { type: 'alert' | 'confirm', message: string, onConfirm?: () => void, onCancel?: () => void }
  
  // Direct edit mode state
  const [directEditMode, setDirectEditMode] = useState(false);
  const [editingCell, setEditingCell] = useState(null); // { rowIndex, colIndex } or null
  const [editValue, setEditValue] = useState(''); // Current value being edited
  
  // Loading state for project submission
  const [isSubmittingProject, setIsSubmittingProject] = useState(false);
  
  // Track modifications made to the dataset
  const [modifications, setModifications] = useState([]);

  // Throttle state saves to avoid excessive sessionStorage writes
  const saveStateTimeoutRef = useRef(null);
  const saveDashboardState = useCallback(() => {
    // Clear any pending save
    if (saveStateTimeoutRef.current) {
      clearTimeout(saveStateTimeoutRef.current);
    }
    
    // Throttle saves to once per 500ms
    saveStateTimeoutRef.current = setTimeout(() => {
      // Don't save CSV data to sessionStorage - it's too large and can exceed quota
      // Only save essential state; CSV data will be reloaded from API when needed
      const state = {
        viewMode,
        selectedProject, // Only save project reference, not the data
        projectName,
        currentCommitId, // Save current commit ID so we know which version is being viewed
        // Don't save csvHeaders, csvRows - too large
        columnWidths,
        rowHeights,
        projects // Include projects list (should be small)
      };
      try {
        const stateString = JSON.stringify(state);
        // Check size before saving (sessionStorage limit is typically 5-10MB)
        if (stateString.length > 4 * 1024 * 1024) { // 4MB threshold
          console.warn('State too large to save, skipping CSV-related data');
          // Save even smaller state without projects if needed
          const minimalState = {
            viewMode,
            selectedProject,
            projectName,
            currentCommitId,
            columnWidths,
            rowHeights
          };
          sessionStorage.setItem('dashboardState', JSON.stringify(minimalState));
        } else {
          sessionStorage.setItem('dashboardState', stateString);
          console.log('✓ Dashboard state saved to sessionStorage');
        }
      } catch (error) {
        if (error.name === 'QuotaExceededError') {
          console.warn('SessionStorage quota exceeded, saving minimal state only');
          // Save only the most essential state
          const minimalState = {
            viewMode,
            selectedProject,
            projectName,
            currentCommitId
          };
          try {
            sessionStorage.setItem('dashboardState', JSON.stringify(minimalState));
          } catch (e) {
            console.error('Failed to save even minimal state:', e);
          }
        } else {
          console.error('Error saving dashboard state:', error);
        }
      }
    }, 500);
  }, [viewMode, selectedProject, projectName, columnWidths, rowHeights, projects]);

  // Handle loading a specific commit (from project history page)
  const handleLoadCommit = async (project, commitId) => {
    console.log('🔄 handleLoadCommit called:', { project: project.name, commitId, rootCommitId: project.root_commit_id });
    setSelectedProject(project);
    setCurrentCommitId(commitId); // Track the current commit being viewed
    setProjectName(project.name);
    setLoadingDataset(true);
    
    try {
      // Use root endpoint if this is the root commit, otherwise use specific commit endpoint
      const endpoint = commitId === project.root_commit_id
        ? `/api/dataset/project/${project.ds_group_id}/root`
        : `/api/dataset/project/${project.ds_group_id}/commit/${commitId}`;
      
      console.log('📥 Loading commit from endpoint:', endpoint);
      const response = await fetch(endpoint, {
        credentials: 'include'
      });
      const result = await response.json();
      if (response.ok && result.success) {
        const { headers, rows } = result.csvData;
        console.log('✅ Commit loaded successfully:', { 
          commitId, 
          headersCount: headers.length, 
          rowsCount: rows.length,
          firstRowSample: rows.length > 0 ? rows[0].slice(0, 3) : 'no rows'
        });
        
        // Reset state
        isResettingProjectRef.current = true;
        setRowHeights({});
        setVisibleRange({ start: 0, end: Math.min(50, rows.length) });
        setScrollTop(0);
        
        // Set data
        setCsvHeaders(headers);
        setCsvRows(rows);
        setCsvData({ headers, rows });
        setViewMode('display');
        setModifications([]);
        
        // Initialize column widths
        const initialWidths = {};
        headers.forEach((_, index) => {
          initialWidths[index] = 150;
        });
        setColumnWidths(initialWidths);
        
        // Reset scroll position
        setTimeout(() => {
          if (tableWrapperRef.current) {
            tableWrapperRef.current.scrollTop = 0;
          }
          isResettingProjectRef.current = false;
        }, 100);
      } else {
        console.error('❌ Failed to load commit:', result.error);
      }
    } catch (error) {
      console.error('❌ Error loading commit:', error);
    } finally {
      setLoadingDataset(false);
    }
  };

  // Check for navigation from project history page
  useEffect(() => {
    if (location.state && location.state.project && location.state.commitId) {
      // User navigated from project history with a specific commit
      console.log('📍 Navigation from project history detected:', {
        project: location.state.project.name,
        commitId: location.state.commitId,
        rootCommitId: location.state.project.root_commit_id
      });
      
      // Clear any saved state to prevent restoreDashboardState from interfering
      sessionStorage.removeItem('dashboardState');
      
      // Load the commit
      handleLoadCommit(location.state.project, location.state.commitId);
      
      // Clear location.state to prevent re-triggering on re-renders
      // Use replaceState to update the history without triggering navigation
      if (window.history && window.history.replaceState) {
        window.history.replaceState({ ...window.history.state }, '');
      }
    }
  }, [location.state]);

  // Restore dashboard state from sessionStorage (only if not navigating from project history)
  const restoreDashboardState = async () => {
    // Don't restore if we're navigating from project history
    if (location.state && location.state.project && location.state.commitId) {
      console.log('Skipping restoreDashboardState - navigating from project history');
      return;
    }
    try {
      const savedState = sessionStorage.getItem('dashboardState');
      console.log('Attempting to restore dashboard state...', savedState ? 'State found' : 'No saved state');
      
      if (savedState) {
        let state;
        try {
          state = JSON.parse(savedState);
        } catch (parseError) {
          console.error('Error parsing saved state, clearing corrupted state:', parseError);
          sessionStorage.removeItem('dashboardState');
          setViewMode('initial');
          return;
        }
        console.log('Restoring state:', { 
          viewMode: state.viewMode, 
          hasProject: !!state.selectedProject,
          hasData: !!(state.csvHeaders && state.csvRows)
        });
        
        // Restore basic state first
        if (state.viewMode) {
          setViewMode(state.viewMode);
        }
        if (state.projectName) {
          setProjectName(state.projectName);
        }
        
        // Restore projects list if available
        if (state.projects && Array.isArray(state.projects)) {
          console.log('Restoring projects list:', state.projects.length, 'projects');
          setProjects(state.projects);
        }
        
        // If we're in select-project mode, reload projects from database
        if (state.viewMode === 'select-project') {
          console.log('In select-project mode, loading projects from database...');
          loadProjects();
        }
        
        // If we had a project loaded, restore it and reload data from API
        if (state.selectedProject && state.selectedProject.ds_group_id && state.viewMode === 'display') {
          console.log('Restoring project display...');
          setSelectedProject(state.selectedProject);
          
          // Restore current commit ID if available, otherwise use root_commit_id
          if (state.currentCommitId) {
            setCurrentCommitId(state.currentCommitId);
          } else if (state.selectedProject.root_commit_id) {
            setCurrentCommitId(state.selectedProject.root_commit_id);
          }
          
          // Restore column widths and row heights if available
          if (state.columnWidths && Object.keys(state.columnWidths).length > 0) {
            console.log('Restoring column widths:', Object.keys(state.columnWidths).length, 'columns');
            setColumnWidths(state.columnWidths);
          }
          
          if (state.rowHeights && Object.keys(state.rowHeights).length > 0) {
            setRowHeights(state.rowHeights);
          }
          
          console.log('✓ Dashboard state restored, reloading project data from API...');
          
          // Determine which commit to load (currentCommitId or root)
          const commitIdToLoad = state.currentCommitId || state.selectedProject.root_commit_id;
          const endpoint = commitIdToLoad === state.selectedProject.root_commit_id
            ? `/api/dataset/project/${state.selectedProject.ds_group_id}/root`
            : `/api/dataset/project/${state.selectedProject.ds_group_id}/commit/${commitIdToLoad}`;
          
          // Always reload CSV data from API (not from sessionStorage - too large)
          fetch(endpoint, {
            credentials: 'include'
          })
            .then(response => {
              if (response.ok) {
                return response.json();
              }
              // If project not found, clear the invalid state
              if (response.status === 404) {
                console.warn('Project not found, clearing invalid state');
                sessionStorage.removeItem('dashboardState');
                setViewMode('initial');
                setSelectedProject(null);
                setCsvData(null);
                setCsvHeaders([]);
                setCsvRows([]);
                return null;
              }
              throw new Error('Failed to reload project');
            })
            .then(result => {
              if (result && result.success) {
                const { headers, rows } = result.csvData;
                console.log('Project data reloaded:', headers.length, 'columns,', rows.length, 'rows');
                setCsvHeaders(headers);
                setCsvRows(rows);
                setCsvData({ headers, rows });
                // Clear modifications when loading a new project
                setModifications([]);
                
                // Initialize column widths if not restored
                if (!state.columnWidths || Object.keys(state.columnWidths).length === 0) {
                  const initialWidths = {};
                  headers.forEach((_, index) => {
                    initialWidths[index] = 150;
                  });
                  setColumnWidths(initialWidths);
                }
              } else if (result === null) {
                // Project not found, state already cleared above
                console.log('Project not found, state cleared');
              } else {
                // API call succeeded but result.success is false
                console.warn('API returned unsuccessful result, resetting to initial view');
                sessionStorage.removeItem('dashboardState');
                setViewMode('initial');
                setSelectedProject(null);
                setCsvData(null);
                setCsvHeaders([]);
                setCsvRows([]);
              }
            })
            .catch(error => {
              console.error('Error reloading project:', error);
              // Clear invalid state and reset to initial view
              // Don't call showAlert here as it's not defined yet - just reset the state
              console.warn('Failed to reload project data, resetting to initial view');
              sessionStorage.removeItem('dashboardState');
              setViewMode('initial');
              setSelectedProject(null);
              setCsvData(null);
              setCsvHeaders([]);
              setCsvRows([]);
            });
        } else if (state.viewMode === 'display' && (!state.selectedProject || !state.selectedProject.ds_group_id)) {
          // If viewMode is 'display' but no valid project, reset to initial
          console.warn('Invalid state: viewMode is display but no valid project, resetting to initial');
          sessionStorage.removeItem('dashboardState');
          setViewMode('initial');
          setSelectedProject(null);
          setCsvData(null);
          setCsvHeaders([]);
          setCsvRows([]);
        } else {
          // Restore column widths and row heights even if not in display mode
          if (state.columnWidths) {
            setColumnWidths(state.columnWidths);
          }
          if (state.rowHeights) {
            setRowHeights(state.rowHeights);
          }
          console.log('✓ Basic dashboard state restored');
        }
      } else {
        console.log('No saved state found, using initial view');
        // Ensure we're in initial view mode if no saved state
        setViewMode('initial');
      }
    } catch (error) {
      console.error('Error restoring dashboard state:', error);
      // Ensure we always show something - reset to initial view on any error
      setViewMode('initial');
      sessionStorage.removeItem('dashboardState');
    }
  };

  // Restore state on mount (before anything else)
  useEffect(() => {
    console.log('🚀 DashboardPage mounted');
    console.log('📊 Initial viewMode:', viewMode);
    // Always ensure we start with a valid viewMode
    const currentViewMode = viewMode || 'initial';
    if (currentViewMode !== viewMode) {
      console.log('🔧 Setting viewMode to initial (was:', viewMode, ')');
      setViewMode('initial');
    }
    // Call restoreDashboardState (it's async but we don't need to wait)
    restoreDashboardState().catch(err => {
      console.error('❌ Error in restoreDashboardState:', err);
      setViewMode('initial');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save state whenever it changes (but skip on initial mount to avoid overwriting restored state)
  const isInitialMount = useRef(true);
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      // Wait a bit before starting to save (to let restore complete)
      return;
    }
    console.log('Saving dashboard state...', { viewMode, hasProject: !!selectedProject, hasData: !!csvData, projectsCount: projects.length, commitId: selectedProject?.root_commit_id });
    saveDashboardState();
  }, [viewMode, selectedProject, projectName, currentCommitId, columnWidths, rowHeights, projects, saveDashboardState]);
  
  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveStateTimeoutRef.current) {
        clearTimeout(saveStateTimeoutRef.current);
      }
    };
  }, []);

  // Load projects list
  const loadProjects = useCallback(async () => {
    setLoadingProjects(true);
    try {
      const response = await fetch('/api/dataset/projects', {
        credentials: 'include'
      });
      const result = await response.json();
      if (response.ok && result.success) {
        setProjects(result.projects || []);
      } else {
        console.error('Error loading projects:', result.error);
        setProjects([]);
      }
    } catch (error) {
      console.error('Error loading projects:', error);
      setProjects([]);
    } finally {
      setLoadingProjects(false);
    }
  }, []);

  // Handle project selection
  const handleSelectProject = async (project) => {
    console.log('🚀 handleSelectProject called:', project?.ds_group_id);
    
    // Reset refs BEFORE setting the new project to ensure the change is detected
    const oldProject = previousProjectRef.current;
    previousCsvRowsLengthRef.current = 0;
    previousProjectRef.current = null;
    console.log('🔄 Resetting refs, old project was:', oldProject);
    
    setSelectedProject(project);
    setLoadingDataset(true);
    
    try {
      const response = await fetch(`/api/dataset/project/${project.ds_group_id}/root`, {
        credentials: 'include'
      });
      const result = await response.json();
      if (response.ok && result.success) {
        const { headers, rows } = result.csvData;
        console.log('📥 Data loaded:', { headers: headers.length, rows: rows.length });
        
        // Reset ALL state BEFORE setting new data to ensure clean slate
        const initialEnd = Math.min(50, rows.length);
        console.log('📊 Resetting all state for new project:', { initialEnd, rowsLength: rows.length });
        
        // Set flag to prevent scroll handler from overriding reset
        isResettingProjectRef.current = true;
        
        // Reset row heights FIRST to ensure estimatedRowHeight recalculates correctly
        setRowHeights({});
        
        // Reset virtual scrolling state
        setVisibleRange({ start: 0, end: initialEnd });
        setScrollTop(0);
        
        // Set data
        setCsvHeaders(headers);
        setCsvRows(rows);
        setCsvData({ headers, rows });
        setProjectName(project.name);
        setViewMode('display');
        
        // Set current commit ID to root when loading from project selection
        setCurrentCommitId(project.root_commit_id);
        
        // Clear modifications when loading a new project
        setModifications([]);
        
        // Initialize column widths
        const initialWidths = {};
        headers.forEach((_, index) => {
          initialWidths[index] = 150;
        });
        setColumnWidths(initialWidths);
        
        // Reset scroll position after DOM updates
        setTimeout(() => {
          console.log('⏰ Timeout: Resetting scroll position');
          if (tableWrapperRef.current) {
            const wrapper = tableWrapperRef.current;
            if (wrapper) {
              wrapper.scrollTop = 0;
              const newEnd = Math.min(50, rows.length);
              setVisibleRange({ start: 0, end: newEnd });
              setScrollTop(0);
              console.log('✅ Scroll reset complete, visibleRange set to:', { start: 0, end: newEnd });
              // Clear the reset flag after a delay to allow scroll handler to work again
              setTimeout(() => {
                isResettingProjectRef.current = false;
                console.log('✅ Reset flag cleared, scroll handler enabled');
              }, 200);
            }
          } else {
            console.warn('⚠️ tableWrapperRef.current is null');
            isResettingProjectRef.current = false;
          }
        }, 100);
      } else {
        console.error('Error loading dataset:', result);
        const errorMessage = result.details || result.error || 'Failed to load dataset';
        await showAlert(`Failed to load dataset: ${errorMessage}`);
      }
    } catch (error) {
      console.error('Error loading dataset:', error);
      await showAlert('Failed to load dataset. Please try again.');
    } finally {
      setLoadingDataset(false);
    }
  };

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      parseCSV(text);
    };
    reader.readAsText(file);
  };

  // Proper CSV parser that handles quoted fields with commas
  const parseCSVLine = (line) => {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const nextChar = line[i + 1];
      
      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          // Escaped quote (double quote)
          current += '"';
          i++; // Skip next quote
        } else {
          // Toggle quote state
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        // End of field
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    
    // Add the last field
    result.push(current.trim());
    return result;
  };

  const parseCSV = (text) => {
    // Split by newlines, but handle quoted fields that may span lines
    const lines = [];
    let currentLine = '';
    let inQuotes = false;
    
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const nextChar = text[i + 1];
      
      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          currentLine += '"';
          i++; // Skip next quote
        } else {
          inQuotes = !inQuotes;
          currentLine += char;
        }
      } else if (char === '\n' && !inQuotes) {
        // End of line (only if not in quotes)
        if (currentLine.trim()) {
          lines.push(currentLine);
        }
        currentLine = '';
      } else {
        currentLine += char;
      }
    }
    
    // Add the last line if it exists
    if (currentLine.trim()) {
      lines.push(currentLine);
    }
    
    if (lines.length === 0) return;

    // Parse headers
    const headers = parseCSVLine(lines[0]);
    setCsvHeaders(headers);

    // Parse rows
    const rows = lines.slice(1)
      .map(line => parseCSVLine(line))
      .filter(row => row.some(cell => cell !== '')); // Remove empty rows

    setCsvRows(rows);
    setCsvData({ headers, rows });
    // Initialize column widths
    const initialWidths = {};
    headers.forEach((_, index) => {
      initialWidths[index] = 150; // Default width
    });
    setColumnWidths(initialWidths);
    // Show project name prompt after CSV is parsed
    setShowNamePrompt(true);
    setViewMode('display');
  };

  const handleSaveProjectVersion = async () => {
    if (!selectedProject || !selectedProject.ds_group_id) {
      console.error('No project selected');
      await showAlert('No project selected. Please select a project first.');
      return;
    }

    // Use currentCommitId if available (when viewing a child commit), otherwise use root_commit_id
    const parentCommitId = currentCommitId || selectedProject.root_commit_id;
    
    if (!parentCommitId) {
      console.error('Missing commit ID');
      await showAlert('Missing commit ID. Please reload the project.');
      return;
    }

    if (modifications.length === 0) {
      await showAlert('No modifications to save. Make some changes to the dataset first.');
      return;
    }

    // Confirm save
    const confirmed = await showConfirm(
      `Save a new version of "${projectName}" with ${modifications.length} modification(s)?`
    );

    if (!confirmed) {
      return;
    }

    try {
      // Convert CSV data to format expected by backend
      // Use the current state from the UI (csvHeaders and csvRows)
      const csvData = {
        headers: csvHeaders,
        rows: csvRows
      };

      console.log('Saving project version with data:', {
        headersCount: csvHeaders.length,
        rowsCount: csvRows.length,
        firstRowSample: csvRows.length > 0 ? csvRows[0].slice(0, 3) : 'no rows',
        modificationsCount: modifications.length
      });

      // Send modifications array directly - backend will handle ordering
      // Each modification is already a string description from recordModification
      const response = await fetch('/api/dataset/save-version', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          dsGroupId: selectedProject.ds_group_id,
          parentCommitId: parentCommitId, // Use current commit ID, not always root
          csvData,
          modifications: modifications // Send array of modification descriptions
        }),
      });

      const result = await response.json();

      if (response.ok) {
        console.log('Project version saved successfully:', result);
        // Update currentCommitId to the new commit so future saves reference this one
        setCurrentCommitId(result.commit_id);
        // Also update selectedProject to keep it in sync
        const updatedProject = {
          ...selectedProject,
          root_commit_id: selectedProject.root_commit_id // Keep root_commit_id unchanged
        };
        setSelectedProject(updatedProject);
        console.log('✅ Current commit updated to:', result.commit_id);
        // Explicitly trigger state save to ensure commit_id is saved to sessionStorage
        setTimeout(() => {
          saveDashboardState();
        }, 100);
        // Clear modifications after saving
        setModifications([]);
        await showAlert('Project version saved successfully!');
      } else {
        console.error('Error saving project version:', result);
        await showAlert(`Error saving project version: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error saving project version:', error);
      await showAlert(`Error saving project version: ${error.message}`);
    }
  };

  const handleDeleteProject = async () => {
    if (!selectedProject || !selectedProject.ds_group_id) {
      // If no selected project, just clear the view (for newly uploaded files not yet saved)
      setCsvData(null);
      setCsvHeaders([]);
      setCsvRows([]);
      setProjectName('');
      setShowNamePrompt(false);
      setSelectedProject(null);
      setViewMode('initial');
      setPreviousViewMode(null);
      sessionStorage.removeItem('dashboardState'); // Clear saved state
      const fileInput = document.getElementById('csv-upload');
      if (fileInput) fileInput.value = '';
      return;
    }

    // Confirm deletion
    const confirmed = await showConfirm(
      `Are you sure you want to delete the project "${projectName || selectedProject.name}"? This action cannot be undone.`
    );

    if (!confirmed) {
      return;
    }

    try {
      const response = await fetch(`/api/dataset/project/${selectedProject.ds_group_id}`, {
        method: 'DELETE',
        credentials: 'include'
      });

      const result = await response.json();

      if (response.ok) {
        console.log('Project deleted successfully:', result);
        // Clear all state and return to initial view
        setCsvData(null);
        setCsvHeaders([]);
        setCsvRows([]);
        setProjectName('');
        setShowNamePrompt(false);
        setSelectedProject(null);
        setViewMode('initial');
        setPreviousViewMode(null);
        sessionStorage.removeItem('dashboardState'); // Clear saved state
        // Reset file input
        const fileInput = document.getElementById('csv-upload');
        if (fileInput) fileInput.value = '';
        // Reload projects list
        loadProjects();
      } else {
        console.error('Error deleting project:', result);
        await showAlert(`Failed to delete project: ${result.error || result.details || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error deleting project:', error);
      await showAlert('Failed to delete project. Please try again.');
    }
  };

  const handleNameSubmit = async (e) => {
    e.preventDefault();
    
    // Prevent multiple submissions
    if (isSubmittingProject) {
      console.log('Submission already in progress, ignoring duplicate click');
      return;
    }
    
    if (!projectName.trim() || !csvData) {
      return;
    }
    
    setIsSubmittingProject(true);
    
    try {
      // Save CSV data to database
      const response = await fetch('/api/dataset/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
          body: JSON.stringify({
            projectName: projectName.trim(),
            csvData: csvData
          })
        });

        const result = await response.json();
        
        if (response.ok) {
          console.log('CSV data saved successfully:', result);
          setShowNamePrompt(false);
          // Store the project info so we can delete it later
          if (result.ds_group_id) {
            const newProject = {
              ds_group_id: result.ds_group_id,
              root_commit_id: result.commit_id,
              name: projectName.trim()
            };
            setSelectedProject(newProject);
            setCurrentCommitId(result.commit_id); // Set current commit to the new commit
            console.log('✅ Selected project updated with new commit_id:', result.commit_id);
            // Explicitly trigger state save to ensure commit_id is saved to sessionStorage
            setTimeout(() => {
              saveDashboardState();
            }, 100);
          }
          // Reload projects list after saving
          loadProjects();
        } else {
          console.error('Error saving CSV data:', result);
          const errorMessage = result.details || result.error || 'Failed to save project';
          await showAlert(errorMessage);
          // If it's a duplicate name error, keep the modal open so user can change the name
          if (result.code === 'DUPLICATE_PROJECT_NAME') {
            // Keep the modal open - don't close it
          } else {
            setShowNamePrompt(false);
          }
        }
      } catch (error) {
        console.error('Error saving CSV data:', error);
        await showAlert('Failed to save project. Please try again.');
      } finally {
        // Always reset loading state, even if there's an error
        setIsSubmittingProject(false);
      }
  };

  const handleMouseDown = (type, index, e) => {
    e.preventDefault();
    e.stopPropagation();
    
    const table = tableRef.current;
    if (!table) return;
    
    if (type === 'column') {
      const thead = table.querySelector('thead');
      if (!thead) return;
      const headers = Array.from(thead.querySelectorAll('th'));
      if (headers[index]) {
        const header = headers[index];
        const rect = header.getBoundingClientRect();
        setResizing({ 
          type: 'column', 
          index, 
          startX: e.clientX, 
          startWidth: rect.width,
          startY: null,
          startHeight: null
        });
      }
    } else if (type === 'row') {
      const tbody = table.querySelector('tbody');
      if (!tbody) return;
      const rows = Array.from(tbody.querySelectorAll('tr'));
      if (rows[index]) {
        const row = rows[index];
        const rect = row.getBoundingClientRect();
        setResizing({ 
          type: 'row', 
          index, 
          startY: e.clientY, 
          startHeight: rect.height,
          startX: null,
          startWidth: null
        });
      }
    }
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!resizing.type || resizing.index === null) return;

      if (resizing.type === 'column' && resizing.startX !== null && resizing.startWidth !== null) {
        const diff = e.clientX - resizing.startX;
        const newWidth = resizing.startWidth + diff;
        
        if (newWidth > 50) { // Minimum width
          setColumnWidths(prev => ({
            ...prev,
            [resizing.index]: newWidth
          }));
        }
      } else if (resizing.type === 'row' && resizing.startY !== null && resizing.startHeight !== null) {
        const diff = e.clientY - resizing.startY;
        const newHeight = resizing.startHeight + diff;
        
        if (newHeight > 30) { // Minimum height
          setRowHeights(prev => ({
            ...prev,
            [resizing.index]: newHeight
          }));
        }
      }
    };

    const handleMouseUp = () => {
      setResizing({ type: null, index: null, startX: null, startY: null, startWidth: null, startHeight: null });
    };

    if (resizing.type) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = resizing.type === 'column' ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';
      
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
    }
  }, [resizing]);

  // Sidebar is available when CSV data is displayed, but can be toggled
  const sidebarAvailable = csvData && viewMode === 'display';
  const [sidebarOpen, setSidebarOpen] = useState(true); // Default to open when available

  // Reset sidebar state when CSV data changes
  useEffect(() => {
    if (sidebarAvailable) {
      setSidebarOpen(true);
    } else {
      setSidebarOpen(false);
    }
  }, [sidebarAvailable]);

  // Update body class to shift navbar when sidebar is open
  useEffect(() => {
    if (sidebarOpen && sidebarAvailable) {
      document.body.classList.add('sidebar-open');
    } else {
      document.body.classList.remove('sidebar-open');
    }
    // Cleanup on unmount
    return () => {
      document.body.classList.remove('sidebar-open');
    };
  }, [sidebarOpen, sidebarAvailable]);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen(prev => !prev);
  }, []);

  // Memoize estimated row height calculation
  // Use a reasonable default and only use actual heights if we have enough samples
  const estimatedRowHeight = useMemo(() => {
    const DEFAULT_HEIGHT = 50;
    const MIN_SAMPLES = 10; // Need at least 10 samples to trust the average
    const knownHeights = Object.values(rowHeights).filter(h => h && h !== 'auto');
    
    if (knownHeights.length < MIN_SAMPLES) {
      // Not enough samples, use default
      return DEFAULT_HEIGHT;
    }
    
    const avgHeight = knownHeights.reduce((sum, h) => {
      const numHeight = typeof h === 'string' ? parseInt(h) : h;
      return sum + (numHeight || DEFAULT_HEIGHT);
    }, 0) / knownHeights.length;
    
    // Cap the estimated height to prevent extreme values
    const MAX_REASONABLE_HEIGHT = 200;
    return Math.min(avgHeight || DEFAULT_HEIGHT, MAX_REASONABLE_HEIGHT);
  }, [rowHeights]);

  // Memoize spacer heights for virtual scrolling
  const aboveSpacerHeight = useMemo(() => {
    if (visibleRange.start === 0 || csvRows.length === 0) return 0;
    let height = 0;
    for (let i = 0; i < visibleRange.start && i < csvRows.length; i++) {
      const rowHeight = rowHeights[i];
      if (rowHeight && rowHeight !== 'auto') {
        const numHeight = typeof rowHeight === 'string' ? parseInt(rowHeight) : rowHeight;
        height += (numHeight && !isNaN(numHeight) && numHeight > 0) ? numHeight : estimatedRowHeight;
      } else {
        height += estimatedRowHeight;
      }
    }
    // Only log if there's an issue
    if (height > 10000 || visibleRange.start > csvRows.length) {
      console.warn('⚠️ Above spacer height seems wrong:', { 
        height, 
        visibleRangeStart: visibleRange.start, 
        csvRowsLength: csvRows.length,
        estimatedRowHeight,
        rowHeightsCount: Object.keys(rowHeights).length 
      });
    }
    return height;
  }, [visibleRange.start, csvRows.length, rowHeights, estimatedRowHeight]);

  const belowSpacerHeight = useMemo(() => {
    if (visibleRange.end >= csvRows.length || csvRows.length === 0) return 0;
    let height = 0;
    for (let i = visibleRange.end; i < csvRows.length; i++) {
      const rowHeight = rowHeights[i];
      if (rowHeight && rowHeight !== 'auto') {
        const numHeight = typeof rowHeight === 'string' ? parseInt(rowHeight) : rowHeight;
        height += (numHeight && !isNaN(numHeight) && numHeight > 0) ? numHeight : estimatedRowHeight;
      } else {
        height += estimatedRowHeight;
      }
    }
    // Only log if there's a real issue (invalid range, not just large height)
    if (visibleRange.end > csvRows.length || visibleRange.start >= csvRows.length) {
      console.warn('⚠️ Below spacer height calculation with invalid range:', { 
        height, 
        visibleRangeEnd: visibleRange.end, 
        csvRowsLength: csvRows.length,
        visibleRangeStart: visibleRange.start,
        estimatedRowHeight,
        rowHeightsCount: Object.keys(rowHeights).length
      });
    }
    return height;
  }, [visibleRange.end, csvRows.length, rowHeights, estimatedRowHeight]);

  // Force reset when project changes - this runs FIRST before other effects
  useEffect(() => {
    const currentProject = selectedProject?.ds_group_id;
    const previousProject = previousProjectRef.current;
    
    console.log('🔍 Project change effect running:', {
      currentProject,
      previousProject,
      viewMode,
      csvRowsLength: csvRows.length,
      currentVisibleRange: visibleRange,
      condition: currentProject && previousProject !== currentProject && viewMode === 'display' && csvRows.length > 0
    });
    
    if (currentProject && previousProject !== currentProject && viewMode === 'display' && csvRows.length > 0) {
      console.log('🔄 PROJECT CHANGED - Force resetting virtual scroll:', {
        previousProject,
        currentProject,
        csvRowsLength: csvRows.length,
        currentVisibleRange: visibleRange
      });
      
      // Force reset everything - use functional updates to ensure we get the latest state
      const initialEnd = Math.min(50, csvRows.length);
      setVisibleRange({ start: 0, end: initialEnd });
      setScrollTop(0);
      setRowHeights({}); // Reset row heights to clear stale data
      
      // Reset scroll position immediately and after DOM update
      if (tableWrapperRef.current) {
        tableWrapperRef.current.scrollTop = 0;
      }
      
      setTimeout(() => {
        if (tableWrapperRef.current) {
          tableWrapperRef.current.scrollTop = 0;
          // Force update visibleRange again to ensure it's set
          setVisibleRange(prev => {
            if (prev.start !== 0 || prev.end !== initialEnd) {
              console.log('🔄 Forcing visibleRange update:', { start: 0, end: initialEnd }, 'previous was:', prev);
              return { start: 0, end: initialEnd };
            }
            return prev;
          });
          console.log('✅ Reset complete, visibleRange:', { start: 0, end: initialEnd });
        }
      }, 50);
      
      // Update ref AFTER resetting state (so next time it will detect the change)
      previousProjectRef.current = currentProject;
      previousCsvRowsLengthRef.current = csvRows.length;
    }
  }, [selectedProject?.ds_group_id, viewMode, csvRows.length]);

  // Reset visible range when viewMode changes to display or csvRows change
  useEffect(() => {
    if (viewMode === 'display' && csvRows.length > 0) {
      const previousLength = previousCsvRowsLengthRef.current;
      const currentLength = csvRows.length;
      const currentProject = selectedProject?.ds_group_id;
      
      // Only reset if length changed significantly and project hasn't changed
      // (project changes are handled by the effect above)
      if (previousLength > 0 && Math.abs(currentLength - previousLength) > Math.max(10, previousLength * 0.1)) {
        console.log('Resetting visible range due to dataset size change:', { previousLength, currentLength });
        setVisibleRange({ start: 0, end: Math.min(50, csvRows.length) });
        setScrollTop(0);
        if (tableWrapperRef.current) {
          tableWrapperRef.current.scrollTop = 0;
        }
        previousCsvRowsLengthRef.current = currentLength;
      } else if (previousLength === 0) {
        // First load
        setVisibleRange({ start: 0, end: Math.min(50, csvRows.length) });
        previousCsvRowsLengthRef.current = currentLength;
        previousProjectRef.current = selectedProject?.ds_group_id;
      }
    }
  }, [viewMode, csvRows.length]);

  // Debug: Track visibleRange changes
  useEffect(() => {
    console.log('🔍 visibleRange state changed:', visibleRange);
  }, [visibleRange]);

  // Virtual scrolling: Calculate visible rows based on scroll position
  useEffect(() => {
    if (!tableWrapperRef.current || !csvRows.length) {
      // Reset to show initial rows if no data or wrapper not ready
      setVisibleRange({ start: 0, end: Math.min(50, csvRows.length) });
      return;
    }

    const wrapper = tableWrapperRef.current;
    const currentProject = selectedProject?.ds_group_id;
    
    // Reset if project changed or dataset size changed significantly
    const previousLength = previousCsvRowsLengthRef.current;
    const previousProject = previousProjectRef.current;
    
    const handleScroll = () => {
      if (!wrapper) {
        console.log('⚠️ Scroll handler: wrapper is null');
        return;
      }
      
      // Don't recalculate if we're in the middle of resetting a project
      if (isResettingProjectRef.current) {
        console.log('⏸️ Scroll handler blocked - reset in progress');
        return;
      }

      const scrollTop = wrapper.scrollTop;
      setScrollTop(scrollTop);

      const viewportHeight = wrapper.clientHeight;
      const bufferRows = 5; // Render extra rows above and below for smooth scrolling

      // Calculate which rows should be visible
      const start = Math.max(0, Math.floor(scrollTop / estimatedRowHeight) - bufferRows);
      const end = Math.min(
        csvRows.length,
        Math.ceil((scrollTop + viewportHeight) / estimatedRowHeight) + bufferRows
      );

      // Always log to debug
      console.log('📜 Scroll handler called:', { 
        scrollTop, 
        start, 
        end, 
        csvRowsLength: csvRows.length,
        estimatedRowHeight,
        viewportHeight
      });
      
      const newRange = { start, end };
      console.log('📜 Setting visibleRange to:', newRange);
      setVisibleRange(newRange);
    };

    // Always reset on project change, or if length changed significantly
    if (currentProject && previousProject !== currentProject) {
      console.log('🔄 Virtual scroll effect: Project changed, resetting:', { previousProject, currentProject, csvRowsLength: csvRows.length });
      
      // Set reset flag to prevent scroll handler from interfering
      isResettingProjectRef.current = true;
      
      wrapper.scrollTop = 0;
      setScrollTop(0);
      const initialEnd = Math.min(50, csvRows.length);
      console.log('🔄 Setting visibleRange to:', { start: 0, end: initialEnd });
      setVisibleRange({ start: 0, end: initialEnd });
      // Reset row heights to ensure spacer calculations are correct for new project
      setRowHeights({});
      
      // Clear reset flag after a delay to allow scroll handler to work
      setTimeout(() => {
        isResettingProjectRef.current = false;
        console.log('✅ Virtual scroll reset flag cleared');
        // Manually trigger scroll handler to ensure visibleRange is updated
        if (wrapper) {
          handleScroll();
        }
      }, 300);
      
      // Update refs AFTER setting state
      previousCsvRowsLengthRef.current = csvRows.length;
      previousProjectRef.current = currentProject;
    } else if (previousLength > 0 && csvRows.length !== previousLength) {
      console.log('Dataset size changed, resetting virtual scroll:', { previousLength, newLength: csvRows.length });
      wrapper.scrollTop = 0;
      setScrollTop(0);
      const initialEnd = Math.min(50, csvRows.length);
      setVisibleRange({ start: 0, end: initialEnd });
      previousCsvRowsLengthRef.current = csvRows.length;
    }

    console.log('🔧 Setting up scroll listener on wrapper:', { 
      wrapperExists: !!wrapper, 
      csvRowsLength: csvRows.length,
      currentProject,
      previousProject,
      isResetting: isResettingProjectRef.current
    });
    
    // Test if scroll events work by adding a simple test listener
    const testScrollHandler = () => {
      console.log('✅ TEST: Scroll event fired! scrollTop:', wrapper.scrollTop);
    };
    wrapper.addEventListener('scroll', testScrollHandler, { passive: true });
    
    wrapper.addEventListener('scroll', handleScroll, { passive: true });
    
    // Initial calculation - but don't override if we just reset for project change
    if (currentProject && previousProject !== currentProject) {
      // Project changed - already reset above, don't recalculate
      console.log('🔄 Skipping initial calculation - project change reset already handled');
      // But ensure visibleRange is set correctly
      const initialEnd = Math.min(50, csvRows.length);
      if (visibleRange.start !== 0 || visibleRange.end !== initialEnd) {
        console.log('🔄 Forcing visibleRange correction:', { start: 0, end: initialEnd });
        setVisibleRange({ start: 0, end: initialEnd });
      }
    } else if (wrapper.scrollTop === 0 && !isResettingProjectRef.current) {
      // Only set initial range if not resetting and scroll is at top
      const initialEnd = Math.min(50, csvRows.length);
      console.log('🔄 Setting initial visibleRange:', { start: 0, end: initialEnd });
      setVisibleRange({ start: 0, end: initialEnd });
    } else if (!isResettingProjectRef.current) {
      // Only call handleScroll if not resetting
      console.log('🔄 Calling handleScroll for initial calculation');
      handleScroll();
    }

    return () => {
      console.log('🧹 Cleaning up scroll listener');
      if (wrapper) {
        wrapper.removeEventListener('scroll', testScrollHandler);
        wrapper.removeEventListener('scroll', handleScroll);
      }
    };
  }, [csvRows, estimatedRowHeight, selectedProject]);

  // Helper function to record a modification
  const recordModification = useCallback((description) => {
    setModifications(prev => [...prev, description]);
  }, []);

  // Operation functions
  const applyOperation = (operationType, inputs) => {
    if (!csvHeaders.length || !csvRows.length) {
      console.warn('No CSV data available for operation');
      return;
    }

    console.log('Applying operation:', operationType, inputs);
    
    let newHeaders = [...csvHeaders];
    let newRows = csvRows.map(row => [...row]);
    const originalRowCount = newRows.length;

    switch (operationType) {
      case 'removeRowsByValue':
        const { columnIndex: removeColIdx, operator, value, caseSensitive } = inputs;
        if (removeColIdx === undefined || removeColIdx === null || !operator) return;
        if (removeColIdx < 0 || removeColIdx >= newHeaders.length) return;
        if (operator !== 'isEmpty' && value === undefined) return;
        
        const isCaseSensitive = caseSensitive || false;
        const compareValue = operator !== 'isEmpty' ? (isCaseSensitive ? value : value.toLowerCase()) : null;
        
        newRows = newRows.filter(row => {
          const cellValue = row[removeColIdx] || '';
          
          if (operator === 'isEmpty') {
            return cellValue.toString().trim() !== '';
          }
          
          const compareCell = isCaseSensitive ? cellValue : cellValue.toLowerCase();
          
          switch (operator) {
            case 'equals': return compareCell !== compareValue;
            case 'contains': return !compareCell.includes(compareValue);
            case 'startsWith': return !compareCell.startsWith(compareValue);
            case 'endsWith': return !compareCell.endsWith(compareValue);
            default: return true;
          }
        });
        const removedCount = originalRowCount - newRows.length;
        recordModification(`Removed ${removedCount} rows from column "${newHeaders[removeColIdx]}" where ${operator}${value ? ` "${value}"` : ''}`);
        break;

      case 'removeDuplicateColumns':
        const seenColumns = new Set();
        const columnsToKeep = [];
        newHeaders.forEach((header, idx) => {
          const normalized = header.toLowerCase().trim();
          if (!seenColumns.has(normalized)) {
            seenColumns.add(normalized);
            columnsToKeep.push(idx);
          }
        });
        newHeaders = columnsToKeep.map(idx => newHeaders[idx]);
        newRows = newRows.map(row => columnsToKeep.map(idx => row[idx]));
        const removedColCount = csvHeaders.length - newHeaders.length;
        recordModification(`Removed ${removedColCount} duplicate column(s)`);
        break;

      case 'replaceColumnValues':
        const { columnIndex: replaceColIdx, findValue, replaceValue, replaceAll } = inputs;
        if (replaceColIdx === undefined || replaceColIdx === null || findValue === undefined || replaceValue === undefined) return;
        if (replaceColIdx < 0 || replaceColIdx >= newHeaders.length) return;
        const replaceAllFlag = replaceAll !== false;
        
        newRows = newRows.map(row => {
          const newRow = [...row];
          let cellValue = newRow[replaceColIdx] || '';
          if (replaceAllFlag) {
            cellValue = cellValue.split(findValue).join(replaceValue);
          } else {
            cellValue = cellValue.replace(findValue, replaceValue);
          }
          newRow[replaceColIdx] = cellValue;
          return newRow;
        });
        const replaceAllText = replaceAllFlag ? 'all occurrences' : 'first occurrence';
        recordModification(`Replaced ${replaceAllText} of "${findValue}" with "${replaceValue}" in column "${newHeaders[replaceColIdx]}"`);
        break;

      case 'sortByColumn':
        const { columnIndex: sortColIdx, sortOrder } = inputs;
        if (sortColIdx === undefined || sortColIdx === null || !sortOrder) return;
        if (sortColIdx < 0 || sortColIdx >= newHeaders.length) return;
        const ascending = sortOrder === 'asc';
        
        newRows.sort((a, b) => {
          const aVal = (a[sortColIdx] || '').toString();
          const bVal = (b[sortColIdx] || '').toString();
          const comparison = aVal.localeCompare(bVal, undefined, { numeric: true, sensitivity: 'base' });
          return ascending ? comparison : -comparison;
        });
        recordModification(`Sorted by column "${newHeaders[sortColIdx]}" (${sortOrder === 'asc' ? 'ascending' : 'descending'})`);
        break;

      case 'removeEmptyRows':
        const emptyRowsBefore = newRows.length;
        newRows = newRows.filter(row => row.some(cell => cell && cell.toString().trim() !== ''));
        const emptyRowsRemoved = emptyRowsBefore - newRows.length;
        if (emptyRowsRemoved > 0) {
          recordModification(`Removed ${emptyRowsRemoved} empty row(s)`);
        }
        break;

      case 'removeDuplicateRows':
        const seenRows = new Set();
        newRows = newRows.filter(row => {
          const rowKey = row.join('|');
          if (seenRows.has(rowKey)) return false;
          seenRows.add(rowKey);
          return true;
        });
        const duplicateRowsRemoved = originalRowCount - newRows.length;
        if (duplicateRowsRemoved > 0) {
          recordModification(`Removed ${duplicateRowsRemoved} duplicate row(s)`);
        }
        break;

      case 'renameColumn':
        const { columnIndex: renameColIdx, newName } = inputs;
        if (renameColIdx === undefined || renameColIdx === null || !newName) return;
        if (renameColIdx < 0 || renameColIdx >= newHeaders.length) return;
        const oldColumnName = newHeaders[renameColIdx];
        newHeaders[renameColIdx] = newName;
        recordModification(`Renamed column "${oldColumnName}" to "${newName}"`);
        break;

      case 'deleteColumn':
        const { columnIndex: deleteColIdx } = inputs;
        if (deleteColIdx === undefined || deleteColIdx === null) return;
        if (deleteColIdx < 0 || deleteColIdx >= newHeaders.length) return;
        newHeaders = newHeaders.filter((_, idx) => idx !== deleteColIdx);
        newRows = newRows.map(row => row.filter((_, idx) => idx !== deleteColIdx));
        // Update column widths - need to rebuild from remaining columns
        const updatedWidths = {};
        newHeaders.forEach((_, newIdx) => {
          // Find the original index for this column
          let originalIdx = 0;
          let found = 0;
          for (let i = 0; i < csvHeaders.length; i++) {
            if (i !== deleteColIdx) {
              if (found === newIdx) {
                originalIdx = i;
                break;
              }
              found++;
            }
          }
          updatedWidths[newIdx] = columnWidths[originalIdx] || 150;
        });
        setColumnWidths(updatedWidths);
        recordModification(`Deleted column "${csvHeaders[deleteColIdx]}"`);
        break;

      case 'addColumn':
        const { newColumnName, defaultValue } = inputs;
        console.log('Add Column operation:', { newColumnName, defaultValue, inputs });
        if (!newColumnName || !newColumnName.trim()) {
          console.warn('Add Column: No column name provided');
          break;
        }
        const newColIndex = newHeaders.length;
        const trimmedName = newColumnName.trim();
        newHeaders.push(trimmedName);
        newRows = newRows.map(row => [...row, defaultValue || '']);
        // Update column widths with the new column index
        const newColumnWidths = { ...columnWidths };
        newColumnWidths[newColIndex] = 150;
        setColumnWidths(newColumnWidths);
        console.log('Add Column: Successfully added column', { newColIndex, trimmedName, newHeadersLength: newHeaders.length });
        recordModification(`Added column "${trimmedName}"`);
        break;

      case 'addRow':
        const { rowValues } = inputs;
        // Create a new row with provided values or empty strings
        const newRow = newHeaders.map((_, idx) => {
          return rowValues && rowValues[idx] !== undefined ? rowValues[idx] : '';
        });
        newRows.push(newRow);
        recordModification('Added 1 row');
        break;

      default:
        console.warn('Unknown operation type:', operationType);
        return;
    }

    // Update state - batch updates for better performance
    const newRowCount = newRows.length;
    console.log(`Operation ${operationType} completed. Rows: ${originalRowCount} -> ${newRowCount}, Headers: ${csvHeaders.length} -> ${newHeaders.length}`);
    
    // Batch state updates using React's automatic batching (React 18+)
    const newCsvData = { headers: [...newHeaders], rows: [...newRows] };
    setCsvHeaders(newHeaders);
    setCsvRows(newRows);
    setCsvData(newCsvData);
    setOperationModal(null);
    setOperationInputs({});
    
  };

  const openOperationModal = useCallback((operationType, initialData = {}) => {
    console.log('=== openOperationModal called ===');
    console.log('Operation type:', operationType);
    console.log('CSV data available:', !!csvData);
    console.log('CSV headers:', csvHeaders.length);
    console.log('CSV rows:', csvRows.length);
    
    // All operations now open a modal
    setOperationModal(operationType);
    setOperationInputs(initialData);
  }, [csvData, csvHeaders.length, csvRows.length]);

  const closeOperationModal = useCallback(() => {
    setOperationModal(null);
    setOperationInputs({});
  }, []);

  // Helper functions for alert/confirm modals
  const showAlert = useCallback((message) => {
    return new Promise((resolve) => {
      setAlertModal({
        type: 'alert',
        message,
        onConfirm: () => {
          setAlertModal(null);
          resolve();
        }
      });
    });
  }, []);

  const showConfirm = useCallback((message) => {
    return new Promise((resolve) => {
      setAlertModal({
        type: 'confirm',
        message,
        onConfirm: () => {
          setAlertModal(null);
          resolve(true);
        },
        onCancel: () => {
          setAlertModal(null);
          resolve(false);
        }
      });
    });
  }, []);

  // Download current CSV data - memoize CSV conversion
  const csvContentMemo = useMemo(() => {
    if (!csvHeaders.length || !csvRows.length) return null;
    
    return [
      csvHeaders.map(header => {
        const escaped = header.toString().replace(/"/g, '""');
        if (escaped.includes(',') || escaped.includes('\n') || escaped.includes('"')) {
          return `"${escaped}"`;
        }
        return escaped;
      }).join(','),
      ...csvRows.map(row => 
        row.map(cell => {
          const cellStr = (cell || '').toString();
          const escaped = cellStr.replace(/"/g, '""');
          if (escaped.includes(',') || escaped.includes('\n') || escaped.includes('"')) {
            return `"${escaped}"`;
          }
          return escaped;
        }).join(',')
      )
    ].join('\n');
  }, [csvHeaders, csvRows]);

  const downloadCurrentData = useCallback(async () => {
    if (!csvContentMemo) {
      await showAlert('No data available to download');
      return;
    }

    // Create blob and download
    const blob = new Blob([csvContentMemo], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `${projectName || 'data'}_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [csvContentMemo, projectName]);

  // Debug: Log sidebar state
  useEffect(() => {
    console.log('Sidebar state:', { sidebarAvailable, sidebarOpen, hasCsvData: !!csvData, viewMode });
    if (sidebarAvailable && sidebarOpen) {
      // Check if buttons exist in DOM
      setTimeout(() => {
        const buttons = document.querySelectorAll('.operation-button');
        console.log('Operation buttons found in DOM:', buttons.length);
        buttons.forEach((btn, idx) => {
          console.log(`Button ${idx}:`, btn.textContent?.trim(), 'clickable:', btn.style.pointerEvents !== 'none');
        });
      }, 100);
    }
  }, [sidebarAvailable, sidebarOpen, csvData, viewMode]);

  // Debug: Log render state
  console.log('🎨 DashboardPage render - viewMode:', viewMode, 'sidebarOpen:', sidebarOpen);
  
  // Safety: Ensure viewMode is always valid
  const safeViewMode = viewMode || 'initial';
  if (safeViewMode !== viewMode && viewMode) {
    console.warn('⚠️ Invalid viewMode detected:', viewMode, '- resetting to initial');
    setViewMode('initial');
  }

  return (
    <div className={`dashboard-page ${sidebarOpen && sidebarAvailable ? 'sidebar-open' : ''}`}>
      <aside className={`dashboard-sidebar ${sidebarOpen && sidebarAvailable ? 'open' : ''}`}>
        {sidebarAvailable && (
          <button 
            className="sidebar-toggle-tab"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              console.log('Toggle sidebar clicked');
              toggleSidebar();
            }}
            aria-label="Toggle sidebar"
          >
            {sidebarOpen ? '◀' : '▶'}
          </button>
        )}
        <div className="sidebar-content">
          <h2 className="sidebar-title">Operations Menu</h2>
          <div className="operations-section">
            <button 
              className="sidebar-button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('View Project History clicked');
                navigate('/project-history');
              }}
            >
              View Project History
            </button>
            
            <h3 className="operations-section-title">Edit Mode</h3>
            <button 
              className={`operation-button ${directEditMode ? 'active' : ''}`}
              style={{ pointerEvents: 'auto', zIndex: 1000, position: 'relative' }}
              onClick={() => {
                const newMode = !directEditMode;
                setDirectEditMode(newMode);
                setEditingCell(null); // Clear any active editing when toggling
                if (!newMode) {
                  setEditValue(''); // Clear edit value when exiting
                }
              }}
            >
              {directEditMode ? 'Exit Direct Edit Mode' : 'Enable Direct Edit Mode'}
            </button>
            
            <h3 className="operations-section-title">Row Operations</h3>
            <button 
              type="button"
              className="operation-button"
              style={{ pointerEvents: directEditMode ? 'none' : 'auto', zIndex: 1000, position: 'relative', opacity: directEditMode ? 0.5 : 1 }}
              onClick={() => {
                console.log('Button clicked: Remove Rows by Value');
                openOperationModal('removeRowsByValue');
              }}
              disabled={directEditMode}
            >
              Remove Rows by Value
            </button>
            <button 
              className="operation-button"
              style={{ pointerEvents: directEditMode ? 'none' : 'auto', zIndex: 1000, position: 'relative', opacity: directEditMode ? 0.5 : 1 }}
              onClick={() => {
                openOperationModal('removeEmptyRows');
              }}
              disabled={directEditMode}
            >
              Remove Empty Rows
            </button>
            <button 
              className="operation-button"
              style={{ pointerEvents: directEditMode ? 'none' : 'auto', zIndex: 1000, position: 'relative', opacity: directEditMode ? 0.5 : 1 }}
              onClick={() => {
                openOperationModal('removeDuplicateRows');
              }}
              disabled={directEditMode}
            >
              Remove Duplicate Rows
            </button>
            <button 
              className="operation-button"
              style={{ pointerEvents: directEditMode ? 'none' : 'auto', zIndex: 1000, position: 'relative', opacity: directEditMode ? 0.5 : 1 }}
              onClick={() => {
                openOperationModal('addRow');
              }}
              disabled={directEditMode}
            >
              Add Row
            </button>
            
            <h3 className="operations-section-title">Column Operations</h3>
            <button 
              className="operation-button"
              style={{ pointerEvents: directEditMode ? 'none' : 'auto', zIndex: 1000, position: 'relative', opacity: directEditMode ? 0.5 : 1 }}
              onClick={() => {
                openOperationModal('removeDuplicateColumns');
              }}
              disabled={directEditMode}
            >
              Remove Duplicate Columns
            </button>
            <button 
              className="operation-button"
              style={{ pointerEvents: directEditMode ? 'none' : 'auto', zIndex: 1000, position: 'relative', opacity: directEditMode ? 0.5 : 1 }}
              onClick={() => {
                openOperationModal('replaceColumnValues');
              }}
              disabled={directEditMode}
            >
              Replace Column Values
            </button>
            <button 
              className="operation-button"
              style={{ pointerEvents: directEditMode ? 'none' : 'auto', zIndex: 1000, position: 'relative', opacity: directEditMode ? 0.5 : 1 }}
              onClick={() => {
                openOperationModal('renameColumn');
              }}
              disabled={directEditMode}
            >
              Rename Column
            </button>
            <button 
              className="operation-button"
              style={{ pointerEvents: directEditMode ? 'none' : 'auto', zIndex: 1000, position: 'relative', opacity: directEditMode ? 0.5 : 1 }}
              onClick={() => {
                openOperationModal('deleteColumn');
              }}
              disabled={directEditMode}
            >
              Delete Column
            </button>
            <button 
              className="operation-button"
              style={{ pointerEvents: directEditMode ? 'none' : 'auto', zIndex: 1000, position: 'relative', opacity: directEditMode ? 0.5 : 1 }}
              onClick={() => {
                openOperationModal('addColumn');
              }}
              disabled={directEditMode}
            >
              Add Column
            </button>
            
            <h3 className="operations-section-title">Sort & Organize</h3>
            <button 
              className="operation-button"
              style={{ pointerEvents: directEditMode ? 'none' : 'auto', zIndex: 1000, position: 'relative', opacity: directEditMode ? 0.5 : 1 }}
              onClick={() => {
                openOperationModal('sortByColumn');
              }}
              disabled={directEditMode}
            >
              Sort by Column
            </button>
          </div>
        </div>
      </aside>

      <div className="dashboard-main">
        <header className="dashboard-header">
          <h1>Dashboard</h1>
          <p className="subtitle">Your data dashboard</p>
        </header>

        <main className="dashboard-content">
        {(!viewMode || viewMode === 'initial') && (
          <InitialView
            onSelectProject={() => {
              setPreviousViewMode('initial');
              setViewMode('select-project');
              loadProjects();
            }}
            onStartNew={() => setViewMode('upload')}
          />
        )}
        {/* Fallback: If somehow no view is rendered, show initial view */}
        {viewMode && viewMode !== 'initial' && viewMode !== 'select-project' && viewMode !== 'upload' && viewMode !== 'display' && (
          <InitialView
            onSelectProject={() => {
              setPreviousViewMode('initial');
              setViewMode('select-project');
              loadProjects();
            }}
            onStartNew={() => setViewMode('upload')}
          />
        )}
        {viewMode === 'select-project' && (
          <ProjectSelectionView
            projects={projects}
            loading={loadingProjects || loadingDataset}
            onSelectProject={handleSelectProject}
            onStartNew={() => {
              // Clear any existing project data when starting a new project
              setCsvData(null);
              setCsvHeaders([]);
              setCsvRows([]);
              setSelectedProject(null);
              setProjectName('');
              setModifications([]);
              // Remember we came from select-project so back button works correctly
              setPreviousViewMode('select-project');
              setViewMode('upload');
            }}
            onBack={() => {
              // Return to previous view mode, or 'initial' if no previous view
              const targetViewMode = previousViewMode || 'initial';
              
              // If going back to 'display' mode, ensure data is restored
              if (targetViewMode === 'display' && selectedProject) {
                // Check if we have CSV data, if not, reload it
                if (!csvData || !csvHeaders.length || !csvRows.length) {
                  console.log('Data missing when going back to display, reloading project...');
                  handleSelectProject(selectedProject);
                } else {
                  // Data exists, ensure csvData object is in sync and change view mode
                  console.log('Data exists, restoring display view...');
                  setCsvData({ headers: csvHeaders, rows: csvRows });
                  // Reset virtual scrolling to show from the beginning
                  setVisibleRange({ start: 0, end: Math.min(50, csvRows.length) });
                  setScrollTop(0);
                  // Reset scroll position if table wrapper exists
                  if (tableWrapperRef.current) {
                    tableWrapperRef.current.scrollTop = 0;
                  }
                  setViewMode('display');
                }
              } else {
                // Not going back to display, just change view mode
                setViewMode(targetViewMode);
              }
              
              setPreviousViewMode(null);
            }}
          />
        )}
        {viewMode === 'upload' && (
          <div className="dashboard-upload">
            <button className="back-button" onClick={() => {
              // If we came from select-project, go back there, otherwise go to initial
              if (previousViewMode === 'select-project') {
                setViewMode('select-project');
                loadProjects();
              } else {
                setViewMode('initial');
              }
            }}>
              ← Back
            </button>
            <div className="upload-area">
              <input
                type="file"
                id="csv-upload"
                accept=".csv"
                onChange={handleFileUpload}
                style={{ display: 'none' }}
              />
              <label htmlFor="csv-upload" className="upload-label">
                <div className="upload-icon">📁</div>
                <h2>Upload CSV File</h2>
                <p>Click here or drag and drop your CSV file</p>
                <span className="upload-hint">Supports .csv files only</span>
              </label>
            </div>
          </div>
        )}
        {showNamePrompt && csvData && (
          <div className="name-prompt-overlay">
            <div className="name-prompt-modal">
              <h2>Name Your Project</h2>
              <p>Please enter a name for this project:</p>
              <form onSubmit={handleNameSubmit}>
                <input
                  type="text"
                  className="project-name-input"
                  placeholder="Enter project name..."
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  autoFocus
                  required
                  disabled={isSubmittingProject}
                />
                <div className="name-prompt-buttons">
                  <button 
                    type="submit" 
                    className="submit-name-button"
                    disabled={isSubmittingProject}
                  >
                    {isSubmittingProject ? 'Saving...' : 'Continue'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
        {/* Fallback: If in display mode but no data, show initial view */}
        {viewMode === 'display' && !csvData && (
          <div style={{ padding: '2rem', textAlign: 'center' }}>
            <p>No data available. Please select a project or start a new one.</p>
            <button 
              onClick={() => {
                setViewMode('initial');
                setSelectedProject(null);
                sessionStorage.removeItem('dashboardState');
              }}
              style={{ 
                marginTop: '1rem', 
                padding: '0.5rem 1rem', 
                background: 'rgba(255, 255, 255, 0.2)',
                border: '1px solid rgba(255, 255, 255, 0.3)',
                borderRadius: '8px',
                color: 'white',
                cursor: 'pointer'
              }}
            >
              Go to Initial View
            </button>
          </div>
        )}
        {viewMode === 'display' && csvData && (
          <div className="dashboard-table-container">
            <div className="table-header">
              <h2 className="project-title">{projectName || 'CSV Data'}</h2>
              <div className="table-header-buttons">
                <div className="table-header-buttons-left">
                  <button 
                    onClick={() => {
                      // Save current view mode so we can return to it
                      setPreviousViewMode('display');
                      setViewMode('select-project');
                      loadProjects();
                    }} 
                    className="change-project-button"
                  >
                    Change Project
                  </button>
                  <button onClick={handleDeleteProject} className="delete-project-button">
                    Delete Project
                  </button>
                </div>
                <div className="table-header-buttons-right">
                  <button 
                    className="save-version-button"
                    onClick={async (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      await handleSaveProjectVersion();
                    }}
                    disabled={!selectedProject || modifications.length === 0 || directEditMode}
                    title={
                      directEditMode 
                        ? "Exit direct edit mode to save version" 
                        : modifications.length === 0 
                          ? "No modifications to save" 
                          : `Save version with ${modifications.length} modification(s)`
                    }
                  >
                    Save Project Version
                  </button>
                  <button 
                    className="download-button"
                    onClick={downloadCurrentData}
                    title="Download current data as CSV"
                  >
                    Download Current Data
                  </button>
                </div>
              </div>
            </div>
            <div 
              className="table-wrapper" 
              ref={tableWrapperRef}
              key={selectedProject?.ds_group_id || 'no-project'}
            >
              <table className="csv-table" ref={tableRef}>
                <thead>
                  <tr>
                    {csvHeaders.map((header, index) => (
                      <th 
                        key={index}
                        style={{ width: columnWidths[index] || 150, minWidth: 50 }}
                        onMouseDown={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          const clickX = e.clientX - rect.left;
                          const cellWidth = rect.width;
                          const borderWidth = 3;
                          
                          // Check if clicking on right border (column resize)
                          if (clickX >= cellWidth - borderWidth) {
                            e.preventDefault();
                            handleMouseDown('column', index, e);
                          }
                        }}
                        onMouseMove={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          const mouseX = e.clientX - rect.left;
                          const cellWidth = rect.width;
                          const borderWidth = 3;
                          
                          // Change cursor when over right border
                          if (mouseX >= cellWidth - borderWidth) {
                            e.currentTarget.style.cursor = 'col-resize';
                          } else {
                            e.currentTarget.style.cursor = 'default';
                          }
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.cursor = 'default';
                        }}
                      >
                        <div className="cell-content">{header}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {/* Virtual scrolling: Render spacer for rows above visible range */}
                  {aboveSpacerHeight > 0 && (
                    <tr style={{ height: aboveSpacerHeight, visibility: 'hidden', pointerEvents: 'none' }}>
                      <td colSpan={csvHeaders.length} style={{ padding: 0, border: 'none' }}></td>
                    </tr>
                  )}
                  {/* Virtual scrolling: Render only visible rows */}
                  {(() => {
                    // Safety check: ensure visibleRange is valid for current dataset
                    const safeStart = Math.max(0, Math.min(visibleRange.start, csvRows.length));
                    const safeEnd = Math.max(safeStart, Math.min(visibleRange.end, csvRows.length));
                    const actualRange = { start: safeStart, end: safeEnd };
                    
                    // If range seems wrong, log it and potentially fix it
                    if (visibleRange.start !== safeStart || visibleRange.end !== safeEnd || visibleRange.end > csvRows.length) {
                      console.warn('⚠️ Invalid visibleRange detected, correcting:', {
                        original: visibleRange,
                        corrected: actualRange,
                        csvRowsLength: csvRows.length,
                        project: selectedProject?.ds_group_id
                      });
                      // Fix the visibleRange if it's invalid
                      if (visibleRange.start !== safeStart || visibleRange.end !== safeEnd) {
                        setVisibleRange(actualRange);
                      }
                    }
                    
                    const visibleRows = csvRows.slice(actualRange.start, actualRange.end);
                    
                    // Always log when rendering to debug the issue
                    console.log('🎨 Rendering rows:', {
                      totalRows: csvRows.length,
                      visibleRangeState: visibleRange,
                      actualRange: actualRange,
                      visibleRowsCount: visibleRows.length,
                      csvRowsHasData: csvRows.length > 0,
                      firstVisibleRowIndex: actualRange.start,
                      lastVisibleRowIndex: actualRange.end - 1,
                      project: selectedProject?.ds_group_id
                    });
                    
                    // Log if we're not showing rows from the start when we should be
                    if (actualRange.start > 0 && tableWrapperRef.current?.scrollTop === 0) {
                      console.warn('⚠️ Rendering rows with non-zero start but scroll is at top:', {
                        totalRows: csvRows.length,
                        visibleRange: actualRange,
                        visibleRowsCount: visibleRows.length,
                        scrollTop: tableWrapperRef.current?.scrollTop,
                        project: selectedProject?.ds_group_id
                      });
                    }
                    
                    // Check if visibleRows is empty or has issues
                    if (visibleRows.length === 0 && csvRows.length > 0) {
                      console.error('❌ No visible rows to render despite having data:', {
                        csvRowsLength: csvRows.length,
                        actualRange,
                        visibleRange
                      });
                    }
                    
                    return visibleRows.map((row, relativeIndex) => {
                    const rowIndex = actualRange.start + relativeIndex;
                    return (
                    <tr 
                      key={rowIndex}
                      style={{ height: rowHeights[rowIndex] || 'auto', minHeight: 30 }}
                      className="resizable-row"
                    >
                      {row.map((cell, cellIndex) => {
                        const isEditing = directEditMode && editingCell && editingCell.rowIndex === rowIndex && editingCell.colIndex === cellIndex;
                        
                        const handleCellClick = (e) => {
                          if (!directEditMode) return;
                          // Don't start editing if clicking on the input itself
                          if (e.target.tagName === 'INPUT') return;
                          
                          const rect = e.currentTarget.getBoundingClientRect();
                          const clickX = e.clientX - rect.left;
                          const clickY = e.clientY - rect.top;
                          const cellWidth = rect.width;
                          const cellHeight = rect.height;
                          const borderWidth = 3;
                          
                          // Don't start editing if clicking on borders
                          if (clickX >= cellWidth - borderWidth || clickY >= cellHeight - borderWidth) {
                            return;
                          }
                          
                          setEditingCell({ rowIndex, colIndex: cellIndex });
                          setEditValue(cell || '');
                        };
                        
                        const handleCellBlur = () => {
                          if (!isEditing) return;
                          // Save the edited value
                          const columnName = csvHeaders[cellIndex] || `Column ${cellIndex + 1}`;
                          const oldValue = cell || '(empty)';
                          const newValue = editValue || '(empty)';
                          
                          if (oldValue === newValue) {
                            setEditingCell(null);
                            return;
                          }
                          
                          
                          const newRows = csvRows.map((r, rIdx) => {
                            if (rIdx === rowIndex) {
                              const newRow = [...r];
                              newRow[cellIndex] = editValue;
                              return newRow;
                            }
                            return r;
                          });
                          setCsvRows(newRows);
                          setCsvData({ headers: csvHeaders, rows: newRows });
                          recordModification(`Edited cell in row ${rowIndex + 1}, column "${columnName}": "${oldValue}" → "${newValue}"`);
                          setEditingCell(null);
                        };
                        
                        const handleCellKeyDown = (e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleCellBlur();
                          } else if (e.key === 'Escape') {
                            setEditingCell(null);
                            setEditValue(cell);
                          }
                        };
                        
                        return (
                          <td 
                            key={cellIndex} 
                            style={{ width: columnWidths[cellIndex] || 150 }}
                            onClick={(e) => {
                              if (directEditMode && !isEditing) {
                                handleCellClick(e);
                              }
                            }}
                            onMouseDown={(e) => {
                              if (directEditMode) {
                                // Let onClick handle it for direct edit mode
                                return;
                              }
                              const rect = e.currentTarget.getBoundingClientRect();
                              const clickX = e.clientX - rect.left;
                              const clickY = e.clientY - rect.top;
                              const cellWidth = rect.width;
                              const cellHeight = rect.height;
                              const borderWidth = 3;
                              
                              if (clickX >= cellWidth - borderWidth) {
                                e.preventDefault();
                                handleMouseDown('column', cellIndex, e);
                              } else if (clickY >= cellHeight - borderWidth) {
                                e.preventDefault();
                                handleMouseDown('row', rowIndex, e);
                              }
                            }}
                            onMouseMove={(e) => {
                              if (directEditMode) {
                                e.currentTarget.style.cursor = 'text';
                                return;
                              }
                              const rect = e.currentTarget.getBoundingClientRect();
                              const mouseX = e.clientX - rect.left;
                              const mouseY = e.clientY - rect.top;
                              const cellWidth = rect.width;
                              const cellHeight = rect.height;
                              const borderWidth = 3;
                              
                              if (mouseX >= cellWidth - borderWidth) {
                                e.currentTarget.style.cursor = 'col-resize';
                              } else if (mouseY >= cellHeight - borderWidth) {
                                e.currentTarget.style.cursor = 'row-resize';
                              } else {
                                e.currentTarget.style.cursor = 'default';
                              }
                            }}
                            onMouseLeave={(e) => {
                              if (!directEditMode) {
                                e.currentTarget.style.cursor = 'default';
                              }
                            }}
                          >
                            {isEditing ? (
                              <input
                                type="text"
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onBlur={handleCellBlur}
                                onKeyDown={handleCellKeyDown}
                                onClick={(e) => e.stopPropagation()}
                                autoFocus
                                style={{
                                  width: '100%',
                                  height: '100%',
                                  minHeight: '30px',
                                  border: 'none',
                                  outline: '2px solid #4a90e2',
                                  padding: '4px',
                                  background: 'white',
                                  color: 'black',
                                  fontSize: 'inherit',
                                  fontFamily: 'inherit',
                                  boxSizing: 'border-box'
                                }}
                              />
                            ) : (
                              <div className="cell-content" style={{ cursor: directEditMode ? 'text' : 'default' }}>{cell}</div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                    });
                  })()}
                  {/* Virtual scrolling: Render spacer for rows below visible range */}
                  {belowSpacerHeight > 0 && (
                    <tr style={{ height: belowSpacerHeight, visibility: 'hidden', pointerEvents: 'none' }}>
                      <td colSpan={csvHeaders.length} style={{ padding: 0, border: 'none' }}></td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="table-info">
              <p>{csvRows.length} rows × {csvHeaders.length} columns</p>
            </div>
          </div>
        )}
        </main>
      </div>
      
      {/* Operation Modal */}
      {operationModal && (
        <OperationModal
          operationType={operationModal}
          inputs={operationInputs}
          setInputs={setOperationInputs}
          onClose={closeOperationModal}
          onApply={(inputs) => {
            applyOperation(operationModal, inputs);
            closeOperationModal();
          }}
          columns={csvHeaders}
        />
      )}
      
      {/* Alert/Confirm Modal */}
      {alertModal && (
        <AlertModal
          type={alertModal.type}
          message={alertModal.message}
          onConfirm={alertModal.onConfirm}
          onCancel={alertModal.onCancel}
        />
      )}
    </div>
  );
}

// Helper component for initial view
function InitialView({ onSelectProject, onStartNew }) {
  return (
    <div className="dashboard-initial-view">
      <div className="initial-view-buttons">
        <button 
          className="initial-button select-project-button"
          onClick={onSelectProject}
        >
          Select Project
        </button>
        <button 
          className="initial-button start-new-button"
          onClick={onStartNew}
        >
          Start a New Project
        </button>
      </div>
    </div>
  );
}

// Helper component for project selection view
function ProjectSelectionView({ projects, loading, onSelectProject, onBack, onStartNew }) {
  return (
    <div className="dashboard-project-selection">
      <button className="back-button" onClick={onBack}>
        ← Back
      </button>
      <h2>Select a Project</h2>
      {loading ? (
        <div className="loading-message">Loading projects...</div>
      ) : projects.length === 0 ? (
        <div className="no-projects-message">
          <p>No projects found.</p>
          <p>Start a new project to get started!</p>
        </div>
      ) : (
        <div className="project-list">
          {projects.map((project) => (
            <button
              key={`${project.ds_group_id}-${project.root_commit_id}`}
              className="project-item"
              onClick={() => onSelectProject(project)}
            >
              {project.name}
            </button>
          ))}
        </div>
      )}
      {!loading && (
        <button 
          className="start-new-from-select-button"
          onClick={onStartNew}
        >
          Or start a new project!
        </button>
      )}
    </div>
  );
}

// Operation Modal Component
function OperationModal({ operationType, inputs, setInputs, onClose, onApply, columns }) {
  const handleSubmit = (e) => {
    e.preventDefault();
    // For operations that don't need input, pass empty object
    const noInputOperations = ['removeEmptyRows', 'removeDuplicateRows', 'removeDuplicateColumns'];
    if (noInputOperations.includes(operationType)) {
      onApply({});
    } else {
      onApply(inputs);
    }
  };

  const renderForm = () => {
    switch (operationType) {
      case 'removeEmptyRows':
        return (
          <div style={{ padding: '1rem', textAlign: 'center' }}>
            <p>This will remove all rows where every cell is empty or contains only whitespace.</p>
            <p style={{ marginTop: '0.5rem', fontWeight: '600' }}>Are you sure you want to proceed?</p>
          </div>
        );

      case 'removeDuplicateRows':
        return (
          <div style={{ padding: '1rem', textAlign: 'center' }}>
            <p>This will remove all duplicate rows, keeping only the first occurrence of each unique row.</p>
            <p style={{ marginTop: '0.5rem', fontWeight: '600' }}>Are you sure you want to proceed?</p>
          </div>
        );

      case 'removeDuplicateColumns':
        return (
          <div style={{ padding: '1rem', textAlign: 'center' }}>
            <p>This will remove all duplicate columns (case-insensitive), keeping only the first occurrence of each unique column name.</p>
            <p style={{ marginTop: '0.5rem', fontWeight: '600' }}>Are you sure you want to proceed?</p>
          </div>
        );

      case 'removeRowsByValue':
        return (
          <>
            <label>
              Column:
              <select
                value={inputs.columnIndex !== undefined && inputs.columnIndex !== null ? inputs.columnIndex : ''}
                onChange={(e) => setInputs({ ...inputs, columnIndex: parseInt(e.target.value) })}
                required
              >
                <option value="">Select column...</option>
                {columns.map((col, idx) => (
                  <option key={idx} value={idx}>{col}</option>
                ))}
              </select>
            </label>
            <label>
              Condition:
              <select
                value={inputs.operator || ''}
                onChange={(e) => setInputs({ ...inputs, operator: e.target.value })}
                required
              >
                <option value="">Select condition...</option>
                <option value="equals">Equals</option>
                <option value="contains">Contains</option>
                <option value="startsWith">Starts with</option>
                <option value="endsWith">Ends with</option>
                <option value="isEmpty">Is empty</option>
              </select>
            </label>
            {inputs.operator && inputs.operator !== 'isEmpty' && (
              <>
                <label>
                  Value:
                  <input
                    type="text"
                    value={inputs.value || ''}
                    onChange={(e) => setInputs({ ...inputs, value: e.target.value })}
                    required
                  />
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={inputs.caseSensitive || false}
                    onChange={(e) => setInputs({ ...inputs, caseSensitive: e.target.checked })}
                  />
                  Case sensitive
                </label>
              </>
            )}
          </>
        );

      case 'replaceColumnValues':
        return (
          <>
            <label>
              Column:
              <select
                value={inputs.columnIndex !== undefined && inputs.columnIndex !== null ? inputs.columnIndex : ''}
                onChange={(e) => setInputs({ ...inputs, columnIndex: parseInt(e.target.value) })}
                required
              >
                <option value="">Select column...</option>
                {columns.map((col, idx) => (
                  <option key={idx} value={idx}>{col}</option>
                ))}
              </select>
            </label>
            <label>
              Find:
              <input
                type="text"
                value={inputs.findValue || ''}
                onChange={(e) => setInputs({ ...inputs, findValue: e.target.value })}
                required
              />
            </label>
            <label>
              Replace with:
              <input
                type="text"
                value={inputs.replaceValue || ''}
                onChange={(e) => setInputs({ ...inputs, replaceValue: e.target.value })}
                required
              />
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={inputs.replaceAll !== false}
                onChange={(e) => setInputs({ ...inputs, replaceAll: e.target.checked })}
              />
              Replace all occurrences
            </label>
            <p style={{ fontSize: '0.85rem', opacity: 0.8, marginTop: '-0.5rem', marginBottom: '0.5rem', paddingLeft: '1.5rem' }}>
              {inputs.replaceAll !== false 
                ? 'All instances of the find value will be replaced in each cell.' 
                : 'Only the first instance of the find value will be replaced in each cell.'}
            </p>
          </>
        );

      case 'sortByColumn':
        return (
          <>
            <label>
              Column:
              <select
                value={inputs.columnIndex !== undefined && inputs.columnIndex !== null ? inputs.columnIndex : ''}
                onChange={(e) => setInputs({ ...inputs, columnIndex: parseInt(e.target.value) })}
                required
              >
                <option value="">Select column...</option>
                {columns.map((col, idx) => (
                  <option key={idx} value={idx}>{col}</option>
                ))}
              </select>
            </label>
            <label>
              Order:
              <select
                value={inputs.sortOrder || 'asc'}
                onChange={(e) => setInputs({ ...inputs, sortOrder: e.target.value })}
                required
              >
                <option value="asc">Ascending (A-Z)</option>
                <option value="desc">Descending (Z-A)</option>
              </select>
            </label>
          </>
        );

      case 'renameColumn':
        return (
          <>
            <label>
              Column:
              <select
                value={inputs.columnIndex !== undefined && inputs.columnIndex !== null ? inputs.columnIndex : ''}
                onChange={(e) => setInputs({ ...inputs, columnIndex: parseInt(e.target.value) })}
                required
              >
                <option value="">Select column...</option>
                {columns.map((col, idx) => (
                  <option key={idx} value={idx}>{col}</option>
                ))}
              </select>
            </label>
            <label>
              New name:
              <input
                type="text"
                value={inputs.newName || ''}
                onChange={(e) => setInputs({ ...inputs, newName: e.target.value })}
                placeholder={inputs.columnIndex !== undefined ? columns[inputs.columnIndex] : 'Enter new name...'}
                required
              />
            </label>
          </>
        );

      case 'deleteColumn':
        return (
          <label>
            Column to delete:
            <select
              value={inputs.columnIndex !== undefined && inputs.columnIndex !== null ? inputs.columnIndex : ''}
              onChange={(e) => setInputs({ ...inputs, columnIndex: parseInt(e.target.value) })}
              required
            >
              <option value="">Select column...</option>
              {columns.map((col, idx) => (
                <option key={idx} value={idx}>{col}</option>
              ))}
            </select>
          </label>
        );

      case 'addColumn':
        return (
          <>
            <label>
              Column name:
              <input
                type="text"
                value={inputs.newColumnName || ''}
                onChange={(e) => setInputs({ ...inputs, newColumnName: e.target.value })}
                placeholder="Enter column name..."
                required
              />
            </label>
            <label>
              Default value (optional):
              <input
                type="text"
                value={inputs.defaultValue || ''}
                onChange={(e) => setInputs({ ...inputs, defaultValue: e.target.value })}
                placeholder="Leave empty for blank cells"
              />
            </label>
          </>
        );

      case 'addRow':
        const rowValues = inputs.rowValues || [];
        return (
          <>
            <p style={{ marginBottom: '1rem', opacity: '0.9' }}>
              Enter values for each column (leave empty for blank cells):
            </p>
            {columns.map((col, idx) => (
              <label key={idx}>
                {col}:
                <input
                  type="text"
                  value={rowValues[idx] || ''}
                  onChange={(e) => {
                    const newRowValues = [...(inputs.rowValues || [])];
                    newRowValues[idx] = e.target.value;
                    setInputs({ ...inputs, rowValues: newRowValues });
                  }}
                  placeholder={`Enter value for ${col}...`}
                />
              </label>
            ))}
          </>
        );

      default:
        return <p>No configuration needed for this operation.</p>;
    }
  };

  const getOperationTitle = () => {
    const titles = {
      removeRowsByValue: 'Remove Rows by Value',
      removeDuplicateColumns: 'Remove Duplicate Columns',
      replaceColumnValues: 'Replace Column Values',
      sortByColumn: 'Sort by Column',
      removeEmptyRows: 'Remove Empty Rows',
      removeDuplicateRows: 'Remove Duplicate Rows',
      renameColumn: 'Rename Column',
      deleteColumn: 'Delete Column',
      addColumn: 'Add Column',
      addRow: 'Add Row'
    };
    return titles[operationType] || 'Operation';
  };

  return (
    <div className="operation-modal-overlay" onClick={onClose}>
      <div className="operation-modal" onClick={(e) => e.stopPropagation()}>
        <div className="operation-modal-header">
          <h2>{getOperationTitle()}</h2>
          <button className="operation-modal-close" onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit} className="operation-modal-form">
          {renderForm()}
          <div className="operation-modal-buttons">
            <button type="button" className="operation-button-cancel" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="operation-button-apply">
              {['removeEmptyRows', 'removeDuplicateRows', 'removeDuplicateColumns'].includes(operationType) ? 'Confirm' : 'Apply'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Alert/Confirm Modal Component
function AlertModal({ type, message, onConfirm, onCancel }) {
  return (
    <div className="operation-modal-overlay" onClick={onCancel || onConfirm}>
      <div className="alert-modal" onClick={(e) => e.stopPropagation()}>
        <div className="operation-modal-header">
          <h2>{type === 'confirm' ? 'Confirm' : 'Alert'}</h2>
        </div>
        <div className="alert-modal-content">
          <p>{message}</p>
        </div>
        <div className="operation-modal-buttons">
          {type === 'confirm' && (
            <button
              className="operation-button-cancel"
              onClick={onCancel}
            >
              Cancel
            </button>
          )}
          <button
            className="operation-button-apply"
            onClick={onConfirm}
          >
            {type === 'confirm' ? 'Confirm' : 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default DashboardPage;

