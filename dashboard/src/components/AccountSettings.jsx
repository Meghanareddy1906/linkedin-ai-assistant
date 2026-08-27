import { useState, useEffect } from 'react';
import axios from 'axios';
import './AccountSettings.css';

function AccountSettings({ onLogout }) {
  const [linkedinStatus, setLinkedinStatus] = useState(null);
  const [whatsappStatus, setWhatsappStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'light');

  useEffect(() => {
    fetchStatuses();
    
    // Apply theme on mount
    document.documentElement.classList.toggle('dark-mode', theme === 'dark');
  }, []);

  const getAuthHeaders = () => {
    const token = localStorage.getItem('dashboardToken');
    return {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    };
  };

  const fetchStatuses = async () => {
    try {
      setLoading(true);

      // Fetch LinkedIn status
      const linkedinRes = await axios.get('http://localhost:3001/api/status/linkedin', getAuthHeaders());
      setLinkedinStatus(linkedinRes.data);

      // Fetch WhatsApp status
      const whatsappRes = await axios.get('http://localhost:3001/api/status/whatsapp', getAuthHeaders());
      setWhatsappStatus(whatsappRes.data);

    } catch (error) {
      console.error('Error fetching statuses:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
    document.documentElement.classList.toggle('dark-mode', newTheme === 'dark');
  };

  const getStatusClass = (status) => {
    if (!status) return 'status-loading';
    if (status.connected) return 'status-connected';
    if (status.status === 'expired') return 'status-warning';
    return 'status-error';
  };

  const formatLastLogin = (dateString) => {
    if (!dateString) return 'Never';
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  return (
    <div className="account-settings">
      <h2>Account Settings</h2>

      {/* Connection Status Section */}
      <div className="settings-section">
        <h3>Connection Status</h3>

        {/* LinkedIn Status */}
        <div className="status-item">
          <div className="status-header">
            <span className="status-label">LinkedIn</span>
            {loading ? (
              <span className="status-indicator status-loading">
                <span className="status-dot"></span>
                <span className="status-text">Checking...</span>
              </span>
            ) : (
              <span className={`status-indicator ${getStatusClass(linkedinStatus)}`}>
                <span className="status-dot"></span>
                <span className="status-text">{linkedinStatus?.message || 'Unknown'}</span>
              </span>
            )}
          </div>
          {linkedinStatus && linkedinStatus.lastLogin && (
            <div className="status-details">
              Last login: {formatLastLogin(linkedinStatus.lastLogin)} 
              {linkedinStatus.daysAgo !== undefined && ` (${linkedinStatus.daysAgo} days ago)`}
            </div>
          )}
        </div>

        {/* WhatsApp Status */}
        <div className="status-item">
          <div className="status-header">
            <span className="status-label">WhatsApp Notifications</span>
            {loading ? (
              <span className="status-indicator status-loading">
                <span className="status-dot"></span>
                <span className="status-text">Checking...</span>
              </span>
            ) : (
              <span className={`status-indicator ${getStatusClass(whatsappStatus)}`}>
                <span className="status-dot"></span>
                <span className="status-text">{whatsappStatus?.message || 'Unknown'}</span>
              </span>
            )}
          </div>
          {whatsappStatus && whatsappStatus.missingVars && whatsappStatus.missingVars.length > 0 && (
            <div className="status-details error">
              Missing variables: {whatsappStatus.missingVars.join(', ')}
            </div>
          )}
        </div>

        <button onClick={fetchStatuses} className="btn-refresh" disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh Status'}
        </button>
      </div>

      {/* Theme Toggle Section */}
      <div className="settings-section">
        <h3>Appearance</h3>
        <div className="theme-toggle-container">
          <span className="theme-label">Dark Mode</span>
          <label className="theme-toggle">
            <input
              type="checkbox"
              checked={theme === 'dark'}
              onChange={toggleTheme}
            />
            <span className="theme-slider"></span>
          </label>
        </div>
      </div>

      {/* Existing Logout Section - UNTOUCHED */}
      <div className="settings-section">
        <h3>Account</h3>
        <button onClick={onLogout} className="btn-logout">
          Logout
        </button>
      </div>
    </div>
  );
}

export default AccountSettings;