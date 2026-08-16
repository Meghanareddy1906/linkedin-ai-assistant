import React, { useState, useEffect } from 'react';
import { apiRequest } from '../App';

function Dashboard({ onLogout }) {
  const [activeTab, setActiveTab] = useState('review');
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(false);
  const [notification, setNotification] = useState('');

  useEffect(() => {
    if (activeTab === 'review') {
      fetchPendingConnections();
    } else if (activeTab === 'sent') {
      fetchSentConnections();
    }
  }, [activeTab]);

  const fetchPendingConnections = async () => {
    setLoading(true);
    try {
      const response = await apiRequest('/connections/pending');
      const data = await response.json();
      setConnections(data);
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchSentConnections = async () => {
    setLoading(true);
    try {
      const response = await apiRequest('/connections/sent');
      const data = await response.json();
      setConnections(data);
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (id) => {
    try {
      await apiRequest(`/connections/${id}/approve`, { method: 'POST' });
      showNotification('Connection approved!');
      fetchPendingConnections();
    } catch (error) {
      console.error('Error:', error);
    }
  };

  const handleReject = async (id) => {
    try {
      await apiRequest(`/connections/${id}/reject`, { method: 'POST' });
      showNotification('Connection rejected');
      fetchPendingConnections();
    } catch (error) {
      console.error('Error:', error);
    }
  };

  const showNotification = (message) => {
    setNotification(message);
    setTimeout(() => setNotification(''), 3000);
  };

  return (
    <>
      <header>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1>LinkedIn Assistant</h1>
          <button 
            onClick={onLogout}
            style={{
              background: '#dc3545',
              color: 'white',
              border: 'none',
              padding: '0.5rem 1rem',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: '500'
            }}
          >
            Logout
          </button>
        </div>
      </header>

      <div className="tabs">
        <button
          className={`tab ${activeTab === 'review' ? 'active' : ''}`}
          onClick={() => setActiveTab('review')}
        >
          Review Connections
        </button>
        <button
          className={`tab ${activeTab === 'sent' ? 'active' : ''}`}
          onClick={() => setActiveTab('sent')}
        >
          Sent History
        </button>
      </div>

      <main>
        {notification && (
          <div className="notification">{notification}</div>
        )}

        <div className="section">
          {loading ? (
            <div className="loading">Loading...</div>
          ) : connections.length === 0 ? (
            <div className="empty-state">
              {activeTab === 'review' 
                ? 'No connections pending review'
                : 'No sent connection requests yet'}
            </div>
          ) : (
            <div className="cards">
              {connections.map((conn) => (
                <div key={conn.id} className="card">
                  <div className="card-header">
                    <div>
                      <h3>{conn.name}</h3>
                      {conn.created_at && (
                        <div className="timestamp">
                          Added: {new Date(conn.created_at).toLocaleDateString()}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="card-body">
                    {conn.headline && (
                      <div className="headline">{conn.headline}</div>
                    )}
                    {conn.company && (
                      <div className="company">{conn.company}</div>
                    )}
                    {conn.profile_url && (
                      <a
                        href={conn.profile_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="profile-link"
                      >
                        View LinkedIn Profile →
                      </a>
                    )}

                    {conn.draft_note && activeTab === 'review' && (
                      <div className="note-section">
                        <strong>Draft Note:</strong>
                        <div className="draft-text">{conn.draft_note}</div>
                      </div>
                    )}

                    {conn.sent_at && activeTab === 'sent' && (
                      <div className="sent-badge">
                        ✓ Sent {new Date(conn.sent_at).toLocaleDateString()}
                      </div>
                    )}
                  </div>

                  {activeTab === 'review' && (
                    <div className="card-actions">
                      <button
                        className="btn btn-approve"
                        onClick={() => handleApprove(conn.id)}
                      >
                        Approve & Send
                      </button>
                      <button
                        className="btn btn-reject"
                        onClick={() => handleReject(conn.id)}
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </>
  );
}

export default Dashboard;