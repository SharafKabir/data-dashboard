import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import './LoginPage.css';

function LoginPage({ onAuthChange }) {
  const [error, setError] = useState(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    // Check for error in URL params
    const errorParam = searchParams.get('error');
    if (errorParam) {
      setError(decodeURIComponent(errorParam));
      setCheckingAuth(false);
      return;
    }

    // First check if user is already authenticated
    fetch('/auth/user', { credentials: 'include' })
      .then(res => {
        if (res.ok) {
          // User is already authenticated, redirect to home
          navigate('/');
          return;
        }
        // User is not authenticated, check if backend is accessible
        return fetch('/api/health');
      })
      .then(() => {
        // Backend is running and user is not authenticated, proceed with login redirect
        if (!error) {
          window.location.href = '/auth/login';
        }
      })
      .catch((err) => {
        console.error('Backend connection error:', err);
        setError('Cannot connect to backend server. Please make sure the server is running on port 3001.');
        setCheckingAuth(false);
      });
  }, [navigate, searchParams, error]);

  if (error) {
    return (
      <div className="login-page">
        <div className="login-container">
          <div className="login-card">
            <h1>Connection Error</h1>
            <p className="login-subtitle" style={{ color: '#f44336' }}>
              {error}
            </p>
            <p style={{ marginTop: '1rem', fontSize: '0.9rem' }}>
              Make sure your backend server is running:
              <br />
              <code style={{ background: 'rgba(255,255,255,0.1)', padding: '0.25rem 0.5rem', borderRadius: '4px' }}>
                cd server && npm run dev
              </code>
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (checkingAuth && !error) {
    return (
      <div className="login-page">
        <div className="login-container">
          <div className="login-card">
            <h1>Redirecting to login...</h1>
            <p className="login-subtitle">
              You will be redirected to AWS Cognito for authentication.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="login-page">
        <div className="login-container">
          <div className="login-card">
            <h1>Connection Error</h1>
            <p className="login-subtitle" style={{ color: '#f44336' }}>
              {error}
            </p>
            <p style={{ marginTop: '1rem', fontSize: '0.9rem' }}>
              Make sure your backend server is running:
              <br />
              <code style={{ background: 'rgba(255,255,255,0.1)', padding: '0.25rem 0.5rem', borderRadius: '4px' }}>
                cd server && npm run dev
              </code>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="login-container">
        <div className="login-card">
          <h1>Login Error</h1>
          <p className="login-subtitle" style={{ color: '#f44336' }}>
            {error || 'An error occurred during authentication'}
          </p>
          <button 
            onClick={() => window.location.href = '/auth/login'}
            className="btn btn-primary"
            style={{ marginTop: '1rem' }}
          >
            Try Again
          </button>
        </div>
      </div>
    </div>
  );
}

export default LoginPage;

