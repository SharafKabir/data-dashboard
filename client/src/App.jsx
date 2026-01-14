import { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import Navbar from './components/Navbar';
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import ViewProjectHistoryPage from './pages/ViewProjectHistoryPage';
import './App.css';

function AppContent({ user, setUser, checkAuthStatus }) {
  const location = useLocation();

  useEffect(() => {
    // check auth when route changes, especially after cognito callback
    checkAuthStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  return (
    <>
      <Navbar user={user} />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<LoginPage onAuthChange={checkAuthStatus} />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/project-history" element={<ViewProjectHistoryPage />} />
      </Routes>
    </>
  );
}

function App() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    // check if user is logged in
    checkAuthStatus();
  }, []);

  const checkAuthStatus = async () => {
    try {
      const response = await fetch('/auth/user', { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        setUser(data.user);
      } else {
        setUser(null);
      }
    } catch (err) {
      setUser(null);
    }
  };

  return (
    <Router>
      <div className="App">
        <AppContent 
          user={user} 
          setUser={setUser} 
          checkAuthStatus={checkAuthStatus} 
        />
      </div>
    </Router>
  );
}

export default App;

