import { useState, useEffect } from 'react';
import axios from 'axios';
import './TargetsTab.css';

function TargetsTab() {
  const [settings, setSettings] = useState({
    target_connections_period: 'weekly',
    target_connections_count: 5,
    target_posts_period: 'weekly',
    target_posts_count: 2
  });

  const [progress, setProgress] = useState({
    connections: { sent: 0, target: 0, period: 'weekly' },
    posts: { sent: 0, target: 0, period: 'weekly' }
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notification, setNotification] = useState('');
  const [errorDetails, setErrorDetails] = useState('');

  // Helper to get auth headers
  const getAuthHeaders = () => {
    const token = localStorage.getItem('dashboardToken');
    return {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    };
  };

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      
      // Fetch settings with auth
      const settingsRes = await axios.get('http://localhost:3001/api/settings', getAuthHeaders());
      setSettings(settingsRes.data);

      // Fetch progress with auth
      const progressRes = await axios.get('http://localhost:3001/api/targets/progress', getAuthHeaders());
      setProgress(progressRes.data);

    } catch (error) {
      console.error('Error fetching data:', error);
      const errorMsg = error.response?.data?.details || error.response?.data?.error || error.message;
      showNotification(`Failed to load settings: ${errorMsg}`, 'error');
      setErrorDetails(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setErrorDetails('');
    
    try {
      console.log('Saving settings:', settings);
      
      const response = await axios.post(
        'http://localhost:3001/api/settings', 
        settings,
        getAuthHeaders()
      );
      
      console.log('Save response:', response.data);
      
      if (response.data.success) {
        showNotification('✓ Settings saved successfully', 'success');
        
        // Refresh progress
        const progressRes = await axios.get('http://localhost:3001/api/targets/progress', getAuthHeaders());
        setProgress(progressRes.data);
      }
    } catch (error) {
      console.error('Error saving settings:', error);
      console.error('Error response:', error.response);
      
      const errorMsg = error.response?.data?.details || error.response?.data?.error || error.message;
      showNotification(`Failed to save settings: ${errorMsg}`, 'error');
      setErrorDetails(errorMsg);
    } finally {
      setSaving(false);
    }
  };

  const showNotification = (message, type = 'info') => {
    setNotification(message);
    setTimeout(() => setNotification(''), 5000);
  };

  const handleInputChange = (field, value) => {
    setSettings(prev => ({
      ...prev,
      [field]: value
    }));
  };

  if (loading) {
    return <div className="loading">Loading settings...</div>;
  }

  return (
    <div className="targets-tab">
      {notification && (
        <div className={`notification ${notification.includes('✓') ? 'success' : 'error'}`}>
          {notification}
          {errorDetails && <div className="error-details">{errorDetails}</div>}
        </div>
      )}

      <div className="targets-container">
        <h2>Target Settings</h2>
        <p className="targets-description">
          Configure your automation targets for connection requests and posts
        </p>

        {/* Connection Request Target Section */}
        <div className="target-section">
          <div className="target-header">
            <h3>📬 Connection Request Target</h3>
            <div className="progress-badge">
              {progress.connections.sent} / {progress.connections.target} this {progress.connections.period === 'daily' ? 'day' : 'week'}
            </div>
          </div>

          <div className="target-progress">
            <div className="progress-bar">
              <div 
                className="progress-fill"
                style={{
                  width: `${Math.min((progress.connections.sent / progress.connections.target) * 100, 100)}%`
                }}
              ></div>
            </div>
            <p className="progress-text">
              {progress.connections.sent} of {progress.connections.target} connection requests sent this {progress.connections.period === 'daily' ? 'day' : 'week'}
            </p>
          </div>

          <div className="target-inputs">
            <div className="input-group">
              <label>Target Count</label>
              <input
                type="number"
                min="0"
                value={settings.target_connections_count}
                onChange={(e) => handleInputChange('target_connections_count', parseInt(e.target.value) || 0)}
                className="target-input"
              />
            </div>

            <div className="input-group">
              <label>Period</label>
              <select
                value={settings.target_connections_period}
                onChange={(e) => handleInputChange('target_connections_period', e.target.value)}
                className="target-select"
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </select>
            </div>
          </div>
        </div>

        {/* Post Generation Target Section */}
        <div className="target-section">
          <div className="target-header">
            <h3>📝 Post Generation Target</h3>
            <div className="progress-badge">
              {progress.posts.sent} / {progress.posts.target} this {progress.posts.period === 'daily' ? 'day' : 'week'}
            </div>
          </div>

          <div className="target-progress">
            <div className="progress-bar">
              <div 
                className="progress-fill"
                style={{
                  width: `${Math.min((progress.posts.sent / progress.posts.target) * 100, 100)}%`
                }}
              ></div>
            </div>
            <p className="progress-text">
              {progress.posts.sent} of {progress.posts.target} posts sent this {progress.posts.period === 'daily' ? 'day' : 'week'}
            </p>
          </div>

          <div className="target-inputs">
            <div className="input-group">
              <label>Target Count</label>
              <input
                type="number"
                min="0"
                value={settings.target_posts_count}
                onChange={(e) => handleInputChange('target_posts_count', parseInt(e.target.value) || 0)}
                className="target-input"
              />
            </div>

            <div className="input-group">
              <label>Period</label>
              <select
                value={settings.target_posts_period}
                onChange={(e) => handleInputChange('target_posts_period', e.target.value)}
                className="target-select"
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </select>
            </div>
          </div>
        </div>

        {/* Save Button */}
        <div className="target-actions">
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-save"
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default TargetsTab;