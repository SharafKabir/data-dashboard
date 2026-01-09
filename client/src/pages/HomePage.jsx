import './HomePage.css';

function HomePage() {
  const operations = [
    {
      category: 'Edit Mode',
      items: [
        {
          name: 'Direct Edit Mode',
          description: 'Enable direct cell editing by clicking on any cell to modify its value inline. When active, other operation buttons are disabled to prevent conflicts.'
        }
      ]
    },
    {
      category: 'Row Operations',
      items: [
        {
          name: 'Remove Rows by Value',
          description: 'Filter and remove rows based on a column value using operators like equals, contains, starts with, ends with, or empty. Supports case-sensitive and case-insensitive matching.'
        },
        {
          name: 'Remove Empty Rows',
          description: 'Delete all rows where every cell is empty or contains only whitespace, helping to clean up datasets with blank entries.'
        },
        {
          name: 'Remove Duplicate Rows',
          description: 'Eliminate rows that are exact duplicates of other rows in the dataset, keeping only unique entries.'
        },
        {
          name: 'Add Row',
          description: 'Insert a new row into the dataset with specified values for each column, or leave cells empty for manual entry.'
        }
      ]
    },
    {
      category: 'Column Operations',
      items: [
        {
          name: 'Remove Duplicate Columns',
          description: 'Remove columns that have duplicate names (case-insensitive), keeping only the first occurrence of each unique column name.'
        },
        {
          name: 'Replace Column Values',
          description: 'Find and replace specific values within a column, with options to replace the first occurrence or all occurrences throughout the column.'
        },
        {
          name: 'Rename Column',
          description: 'Change the name of a column header to better reflect its contents or fix naming inconsistencies.'
        },
        {
          name: 'Delete Column',
          description: 'Permanently remove a column and all its data from the dataset, useful for eliminating unnecessary or redundant information.'
        },
        {
          name: 'Add Column',
          description: 'Create a new column with a specified name and optional default value for all existing rows, expanding your dataset structure.'
        }
      ]
    },
    {
      category: 'Sort & Organize',
      items: [
        {
          name: 'Sort by Column',
          description: 'Reorder all rows based on the values in a selected column, in either ascending or descending order. Supports both text and numeric sorting.'
        }
      ]
    }
  ];

  return (
    <div className="home-page">
      <header className="home-header">
        <h1>Data Dashboard</h1>
        <p className="subtitle">Welcome to your data visualization platform</p>
      </header>

      <main className="home-content">
        <section className="features-section">
          <h2>Features</h2>
          <div className="features-grid">
            <div className="feature-card">
              <h3>📝 Intuitive Interface</h3>
              <p>User-friendly dataset editor designed for users of all skill levels. Click and edit cells directly, or use guided operations to transform your data without any technical expertise.</p>
            </div>
            <div className="feature-card">
              <h3>☁️ Cloud Storage</h3>
              <p>All your datasets are automatically saved to secure cloud storage. Access your projects from anywhere, with no local file management required.</p>
            </div>
            <div className="feature-card">
              <h3>🔒 Enterprise Security</h3>
              <p>Your data is protected with AWS S3's enterprise-grade security features. Each user's data is isolated and encrypted, ensuring complete privacy and protection.</p>
            </div>
            <div className="feature-card">
              <h3>🛠️ Advanced Operations</h3>
              <p>Powerful data manipulation tools including filtering, sorting, deduplication, and column transformations. Clean and prepare your datasets with just a few clicks.</p>
            </div>
            <div className="feature-card">
              <h3>📊 Version History</h3>
              <p>Track every change with visual project history graphs. View, compare, and restore previous versions of your datasets with an intuitive commit-based system.</p>
            </div>
            <div className="feature-card">
              <h3>📁 Project Management</h3>
              <p>Organize multiple datasets as separate projects. Each project maintains its own version history, making it easy to manage and track different data workflows.</p>
            </div>
          </div>
        </section>

        <section className="operations-section">
          <h2>Data Operations</h2>
          <div className="operations-list">
            {operations.map((category, categoryIndex) => (
              <div key={categoryIndex} className="operations-category">
                <h3 className="category-title">{category.category}</h3>
                <div className="operations-items">
                  {category.items.map((operation, operationIndex) => (
                    <div key={operationIndex} className="operation-item">
                      <h4 className="operation-name">{operation.name}</h4>
                      <p className="operation-description">{operation.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

export default HomePage;

