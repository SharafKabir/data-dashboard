import { Link, useLocation } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import './Navbar.css';

function Navbar({ user }) {
  const location = useLocation();
  const wrapperRef = useRef(null);

  const handleLogout = () => {
    // Redirect to backend logout endpoint which handles Cognito logout
    window.location.href = '/auth/logout';
  };

  // Update navbar background width to cover full document width
  useEffect(() => {
    const updateBackgroundWidth = () => {
      if (wrapperRef.current) {
        // Get the full scrollable width of the document
        const documentWidth = Math.max(
          document.documentElement.scrollWidth,
          document.documentElement.clientWidth,
          document.body.scrollWidth,
          document.body.clientWidth,
          document.documentElement.offsetWidth,
          document.body.offsetWidth
        );
        const sidebarOffset = document.body.classList.contains('sidebar-open') ? 300 : 0;
        const backgroundElement = wrapperRef.current.querySelector('.navbar-background');
        const navbarElement = wrapperRef.current.querySelector('.navbar');
        if (backgroundElement && navbarElement) {
          const navbarHeight = navbarElement.offsetHeight;
          // For fixed positioning, start from left edge of viewport (0 when sidebar closed, 300 when open)
          // Extend to full document width
          const totalWidth = documentWidth - sidebarOffset;
          
          backgroundElement.style.left = `${sidebarOffset}px`;
          backgroundElement.style.width = `${totalWidth}px`;
          backgroundElement.style.height = `${navbarHeight}px`;
        }
      }
    };

    // Initial update with a small delay to ensure DOM is ready
    const timeoutId = setTimeout(updateBackgroundWidth, 100);
    
    // Update on resize and scroll (both vertical and horizontal)
    window.addEventListener('resize', updateBackgroundWidth);
    window.addEventListener('scroll', updateBackgroundWidth, true); // Use capture phase
    
    // Use MutationObserver to detect when sidebar opens/closes
    const observer = new MutationObserver(() => {
      setTimeout(updateBackgroundWidth, 50);
    });
    if (document.body) {
      observer.observe(document.body, {
        attributes: true,
        attributeFilter: ['class']
      });
    }

    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('resize', updateBackgroundWidth);
      window.removeEventListener('scroll', updateBackgroundWidth, true);
      observer.disconnect();
    };
  }, [location.pathname]); // Re-run when route changes

  return (
    <div className="navbar-wrapper" ref={wrapperRef}>
      <div className="navbar-background"></div>
      <nav className="navbar">
        <div className="navbar-container">
          <div className="navbar-left">
            <Link to="/" className="navbar-logo">
              <span>Data Dashboard</span>
            </Link>
            {user && user.email && (
              <span className="navbar-email">Logged in as {user.email}</span>
            )}
          </div>
          <div className="navbar-menu">
            <Link 
              to="/" 
              className={`navbar-link ${location.pathname === '/' ? 'active' : ''}`}
            >
              Home
            </Link>
            {user && (
              <Link 
                to="/dashboard" 
                className={`navbar-link ${location.pathname === '/dashboard' ? 'active' : ''}`}
              >
                Dashboard
              </Link>
            )}
            {user ? (
              <button 
                onClick={handleLogout}
                className="navbar-link navbar-button"
              >
                Logout
              </button>
            ) : (
              <Link 
                to="/login" 
                className={`navbar-link ${location.pathname === '/login' ? 'active' : ''}`}
              >
                Login
              </Link>
            )}
          </div>
        </div>
      </nav>
    </div>
  );
}

export default Navbar;

