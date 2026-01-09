import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import './ViewProjectHistoryPage.css';

function ViewProjectHistoryPage() {
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [commits, setCommits] = useState([]);
  const [modifications, setModifications] = useState({}); // commit_id -> modifications array
  const [hoveredEdge, setHoveredEdge] = useState(null); // { from, to, x, y }
  const [loading, setLoading] = useState(false);
  const [nodeLabels, setNodeLabels] = useState({}); // commit_id -> label
  const [selectedNode, setSelectedNode] = useState(null); // { commitId, x, y }
  const [renameInput, setRenameInput] = useState('');
  const svgRef = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();

  // Fetch projects on mount
  useEffect(() => {
    fetchProjects();
  }, []);

  // Fetch commits when project is selected
  useEffect(() => {
    if (selectedProject) {
      fetchCommits(selectedProject.ds_group_id);
      // Load node labels from localStorage
      loadNodeLabels(selectedProject.ds_group_id);
    }
  }, [selectedProject]);

  // Load node labels from localStorage
  const loadNodeLabels = (dsGroupId) => {
    try {
      const stored = localStorage.getItem(`nodeLabels_${dsGroupId}`);
      if (stored) {
        setNodeLabels(JSON.parse(stored));
      }
    } catch (error) {
      console.error('Error loading node labels:', error);
    }
  };

  // Save node labels to localStorage
  const saveNodeLabels = (dsGroupId, labels) => {
    try {
      localStorage.setItem(`nodeLabels_${dsGroupId}`, JSON.stringify(labels));
    } catch (error) {
      console.error('Error saving node labels:', error);
    }
  };

  const fetchProjects = async () => {
    try {
      const response = await fetch('/api/dataset/projects', {
        credentials: 'include'
      });
      const result = await response.json();
      if (result.success) {
        setProjects(result.projects);
      }
    } catch (error) {
      console.error('Error fetching projects:', error);
    }
  };

  const fetchCommits = async (dsGroupId) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/dataset/project/${dsGroupId}/commits`, {
        credentials: 'include'
      });
      const result = await response.json();
      if (result.success) {
        setCommits(result.commits);
        // Fetch modifications for each commit
        fetchAllModifications(result.commits);
      }
    } catch (error) {
      console.error('Error fetching commits:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchAllModifications = async (commitsList) => {
    const mods = {};
    for (const commit of commitsList) {
      if (commit.parent_commit_id) {
        try {
          const response = await fetch(`/api/dataset/commit/${commit.commit_id}/modifications`, {
            credentials: 'include'
          });
          const result = await response.json();
          if (result.success) {
            mods[commit.commit_id] = result.modifications;
          }
        } catch (error) {
          console.error(`Error fetching modifications for commit ${commit.commit_id}:`, error);
        }
      }
    }
    setModifications(mods);
  };

  // Generate user-friendly default name for a commit
  const getDefaultNodeName = (commit, index, allCommits) => {
    // Check if we have a custom label
    if (nodeLabels[commit.commit_id]) {
      return nodeLabels[commit.commit_id];
    }
    
    // Generate default name based on position in tree
    if (!commit.parent_commit_id) {
      return 'Version 1 (Root)';
    }
    
    // Count how many commits are at the same level (same parent or same generation)
    // For simplicity, just use index + 1
    const commitIndex = allCommits.findIndex(c => c.commit_id === commit.commit_id);
    return `Version ${commitIndex + 1}`;
  };

  // Build graph structure
  const buildGraph = () => {
    if (!commits.length) return { nodes: [], edges: [] };

    const nodes = commits.map((commit, index) => ({
      id: commit.commit_id,
      commitId: commit.commit_id,
      label: getDefaultNodeName(commit, index, commits),
      isRoot: !commit.parent_commit_id
    }));

    const edges = commits
      .filter(commit => commit.parent_commit_id)
      .map(commit => ({
        from: commit.parent_commit_id,
        to: commit.commit_id,
        commitId: commit.commit_id
      }));

    return { nodes, edges };
  };

  // Calculate positions for hierarchical layout
  const calculatePositions = (nodes, edges) => {
    // Find root node
    const rootNode = nodes.find(n => n.isRoot);
    if (!rootNode) return {};

    // Build adjacency list
    const children = {};
    edges.forEach(edge => {
      if (!children[edge.from]) {
        children[edge.from] = [];
      }
      children[edge.from].push(edge.to);
    });

    // Calculate levels (BFS)
    const levels = {};
    const queue = [{ id: rootNode.id, level: 0 }];
    const visited = new Set();

    while (queue.length > 0) {
      const { id, level } = queue.shift();
      if (visited.has(id)) continue;
      visited.add(id);

      if (!levels[level]) {
        levels[level] = [];
      }
      levels[level].push(id);

      if (children[id]) {
        children[id].forEach(childId => {
          if (!visited.has(childId)) {
            queue.push({ id: childId, level: level + 1 });
          }
        });
      }
    }

    // Calculate positions
    const positions = {};
    const horizontalSpacing = 200;
    const verticalSpacing = 150;

    Object.keys(levels).forEach(level => {
      const levelNodes = levels[level];
      const levelWidth = levelNodes.length * horizontalSpacing;
      const startX = (1000 - levelWidth) / 2; // Assuming SVG width of 1000

      levelNodes.forEach((nodeId, index) => {
        positions[nodeId] = {
          x: startX + index * horizontalSpacing,
          y: parseInt(level) * verticalSpacing + 100
        };
      });
    });

    return positions;
  };

  const handleEdgeMouseEnter = (edge, event) => {
    const mods = modifications[edge.commitId] || [];
    if (mods.length > 0) {
      const point = svgRef.current.createSVGPoint();
      point.x = event.clientX;
      point.y = event.clientY;
      const svgPoint = point.matrixTransform(svgRef.current.getScreenCTM().inverse());
      
      setHoveredEdge({
        from: edge.from,
        to: edge.to,
        modifications: mods,
        x: svgPoint.x,
        y: svgPoint.y
      });
    }
  };

  const handleEdgeMouseLeave = () => {
    setHoveredEdge(null);
  };

  const handleNodeClick = (node, event) => {
    const point = svgRef.current.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const svgPoint = point.matrixTransform(svgRef.current.getScreenCTM().inverse());
    
    setSelectedNode({
      commitId: node.id,
      label: node.label,
      x: svgPoint.x,
      y: svgPoint.y
    });
    setRenameInput(node.label);
  };

  const handleRename = () => {
    if (!selectedNode || !renameInput.trim()) return;
    
    const newLabels = { ...nodeLabels, [selectedNode.commitId]: renameInput.trim() };
    setNodeLabels(newLabels);
    saveNodeLabels(selectedProject.ds_group_id, newLabels);
    setSelectedNode(null);
    setRenameInput('');
  };

  const handleViewDataset = () => {
    if (!selectedNode || !selectedProject) return;
    
    // Find the commit in the commits list to get the actual commit_id
    const commit = commits.find(c => c.commit_id === selectedNode.commitId);
    if (!commit) {
      console.error('Commit not found:', selectedNode.commitId);
      return;
    }
    
    // Determine if this is the root commit (parent_commit_id is null)
    const isRoot = !commit.parent_commit_id;
    
    // If this is the root, ensure we use the actual root commit ID from the database
    // (not the one stored in selectedProject.root_commit_id which might be outdated)
    const commitIdToLoad = isRoot ? commit.commit_id : selectedNode.commitId;
    
    console.log('🔄 Navigating to dashboard with commit:', {
      commitId: selectedNode.commitId,
      commitIdToLoad,
      isRoot,
      hasParent: !!commit.parent_commit_id,
      projectRootCommitId: selectedProject.root_commit_id
    });
    
    // Create a project object with the correct root_commit_id for the dashboard
    const projectForDashboard = {
      ...selectedProject,
      root_commit_id: isRoot ? commit.commit_id : selectedProject.root_commit_id
    };
    
    // Navigate to dashboard with commit info in state
    navigate('/dashboard', {
      state: {
        project: projectForDashboard,
        commitId: commitIdToLoad
      }
    });
  };

  const handleCloseModal = () => {
    setSelectedNode(null);
    setRenameInput('');
  };

  // Rebuild graph when commits or nodeLabels change
  const { nodes, edges } = useMemo(() => buildGraph(), [commits, nodeLabels]);
  const positions = useMemo(() => calculatePositions(nodes, edges), [nodes, edges]);

  return (
    <div className="view-project-history-page">
      <div className="page-container">
        <div className="content-box">
          <h1>Project History</h1>
          
          {!selectedProject ? (
            <div className="project-selection">
              <h2>Select a Project</h2>
              {projects.length === 0 ? (
                <p>No projects found. Create a project first.</p>
              ) : (
                <div className="project-list">
                  {projects.map(project => (
                    <button
                      key={project.ds_group_id}
                      className="project-item"
                      onClick={() => setSelectedProject(project)}
                    >
                      {project.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="graph-container">
              <div className="graph-header">
                <button className="back-button" onClick={() => setSelectedProject(null)}>
                  ← Back to Projects
                </button>
                <h2>{selectedProject.name}</h2>
              </div>
              
              {loading ? (
                <p>Loading commits...</p>
              ) : nodes.length === 0 ? (
                <p>No commits found for this project.</p>
              ) : (
                <div className="graph-wrapper">
                  <svg
                    ref={svgRef}
                    width={Math.max(1000, Object.keys(positions).length > 0 ? Math.max(...Object.values(positions).map(p => p.x)) + 200 : 1000)}
                    height={Math.max(600, Object.keys(positions).length > 0 ? Math.max(...Object.values(positions).map(p => p.y)) + 150 : 600)}
                    className="history-graph"
                  >
                    {/* Render edges first (so they appear behind nodes) */}
                    {edges.map((edge, index) => {
                      const fromPos = positions[edge.from];
                      const toPos = positions[edge.to];
                      if (!fromPos || !toPos) return null;

                      // Create a wider invisible line for easier hover detection
                      const midX = (fromPos.x + toPos.x) / 2 + 60;
                      const midY = (fromPos.y + toPos.y) / 2 + 40;

                      return (
                        <g key={`edge-${index}`}>
                          {/* Visible line */}
                          <line
                            x1={fromPos.x + 60}
                            y1={fromPos.y + 40}
                            x2={toPos.x + 60}
                            y2={toPos.y + 40}
                            stroke="rgba(255, 255, 255, 0.6)"
                            strokeWidth="2"
                            className="graph-edge"
                          />
                          {/* Invisible wider line for hover detection */}
                          <line
                            x1={fromPos.x + 60}
                            y1={fromPos.y + 40}
                            x2={toPos.x + 60}
                            y2={toPos.y + 40}
                            stroke="transparent"
                            strokeWidth="20"
                            className="graph-edge-hover"
                            onMouseEnter={(e) => handleEdgeMouseEnter(edge, e)}
                            onMouseLeave={handleEdgeMouseLeave}
                          />
                        </g>
                      );
                    })}

                    {/* Render nodes */}
                    {nodes.map(node => {
                      const pos = positions[node.id];
                      if (!pos) return null;

                      return (
                        <g key={node.id}>
                          <rect
                            x={pos.x}
                            y={pos.y}
                            width="120"
                            height="80"
                            rx="8"
                            fill={node.isRoot ? "rgba(76, 175, 80, 0.8)" : "rgba(255, 255, 255, 0.2)"}
                            stroke="rgba(255, 255, 255, 0.5)"
                            strokeWidth="2"
                            className="graph-node"
                            onClick={(e) => handleNodeClick(node, e)}
                            style={{ cursor: 'pointer' }}
                          />
                          <text
                            x={pos.x + 60}
                            y={pos.y + 45}
                            textAnchor="middle"
                            fill="white"
                            fontSize="12"
                            fontWeight="600"
                            onClick={(e) => handleNodeClick(node, e)}
                            style={{ cursor: 'pointer', pointerEvents: 'auto' }}
                          >
                            {node.label.length > 15 ? node.label.substring(0, 12) + '...' : node.label}
                          </text>
                          {node.isRoot && (
                            <text
                              x={pos.x + 60}
                              y={pos.y + 65}
                              textAnchor="middle"
                              fill="white"
                              fontSize="11"
                              opacity="0.8"
                              onClick={(e) => handleNodeClick(node, e)}
                              style={{ cursor: 'pointer', pointerEvents: 'auto' }}
                            >
                              Root
                            </text>
                          )}
                        </g>
                      );
                    })}
                  </svg>

                  {/* Modifications tooltip */}
                  {hoveredEdge && (
                    <div
                      className="modifications-tooltip"
                      style={{
                        position: 'absolute',
                        left: `${hoveredEdge.x + 20}px`,
                        top: `${hoveredEdge.y + 20}px`,
                        pointerEvents: 'none'
                      }}
                    >
                      <h3>Modifications</h3>
                      <ol>
                        {hoveredEdge.modifications.map((mod, index) => (
                          <li key={index}>{mod.description}</li>
                        ))}
                      </ol>
                    </div>
                  )}

                  {/* Node action modal */}
                  {selectedNode && (
                    <div
                      className="node-action-modal-overlay"
                      onClick={handleCloseModal}
                    >
                      <div
                        className="node-action-modal"
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          position: 'absolute',
                          left: `${selectedNode.x + 70}px`,
                          top: `${selectedNode.y + 50}px`
                        }}
                      >
                        <h3>Node Actions</h3>
                        <div className="node-action-content">
                          <div className="node-action-section">
                            <label>
                              Rename Label:
                              <input
                                type="text"
                                value={renameInput}
                                onChange={(e) => setRenameInput(e.target.value)}
                                placeholder="Enter new label"
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    handleRename();
                                  } else if (e.key === 'Escape') {
                                    handleCloseModal();
                                  }
                                }}
                                autoFocus
                              />
                            </label>
                            <button onClick={handleRename} className="action-button">
                              Rename
                            </button>
                          </div>
                          <div className="node-action-divider"></div>
                          <div className="node-action-section">
                            <button onClick={handleViewDataset} className="action-button primary">
                              View Dataset in Dashboard
                            </button>
                          </div>
                        </div>
                        <button className="close-button" onClick={handleCloseModal}>
                          ×
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ViewProjectHistoryPage;
