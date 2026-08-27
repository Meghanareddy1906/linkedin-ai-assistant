import { useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';
import Login from './components/Login';
import TargetsTab from './components/TargetsTab';
import AccountSettings from './components/AccountSettings';

function App() {
  // ADD AUTHENTICATION STATE AT THE TOP
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isChecking, setIsChecking] = useState(true);

  // CHECK AUTHENTICATION ON MOUNT
  useEffect(() => {
    const token = localStorage.getItem('dashboardToken');
    setIsAuthenticated(!!token);
    setIsChecking(false);
  }, []);

  // SHOW LOADING WHILE CHECKING AUTH
  if (isChecking) {
    return <div className="loading">Checking authentication...</div>;
  }

  // SHOW LOGIN PAGE IF NOT AUTHENTICATED
  if (!isAuthenticated) {
    return <Login onLoginSuccess={() => setIsAuthenticated(true)} />;
  }

  // IF AUTHENTICATED, RENDER THE DASHBOARD
  return <Dashboard />;
}

// MOVE ALL EXISTING CODE INTO A DASHBOARD COMPONENT
function Dashboard() {
  const [activeTab, setActiveTab] = useState('replies');
  const [replies, setReplies] = useState([]);
  const [connections, setConnections] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [posts, setPosts] = useState([]);
  const [sentHistory, setSentHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notification, setNotification] = useState('');
  const [regenerating, setRegenerating] = useState({});
  const [customPrompts, setCustomPrompts] = useState({});
  const [showPromptInput, setShowPromptInput] = useState({});
  const [jobSearchKeywords, setJobSearchKeywords] = useState('');
  const [jobSearchLocation, setJobSearchLocation] = useState('');
  const [searchingJobs, setSearchingJobs] = useState(false);
  const [postTopic, setPostTopic] = useState('');
  const [generatingPost, setGeneratingPost] = useState(false);
  const [presenceOnline, setPresenceOnline] = useState(true);
  const [loadingApprove, setLoadingApprove] = useState(null);

  useEffect(() => {
    fetchPendingItems();
  }, []);

  useEffect(() => {
    if (activeTab === 'history') {
      fetchSentHistory();
    }
  }, [activeTab]);

  useEffect(() => {
    const sendHeartbeat = async () => {
      try {
        await fetch('http://localhost:3001/api/heartbeat', {
          method: 'POST'
        });
      } catch (error) {
        console.error('Heartbeat failed:', error);
      }
    };

    sendHeartbeat();
    const heartbeatInterval = setInterval(sendHeartbeat, 30000);
    return () => clearInterval(heartbeatInterval);
  }, []);

  const fetchPendingItems = async () => {
    try {
      const response = await axios.get('http://localhost:3001/api/pending');
      setReplies(response.data.replies);
      setConnections(response.data.connections);
      setJobs(response.data.jobs);
      setPosts(response.data.posts);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching pending items:', error);
      setLoading(false);
    }
  };

  const fetchSentHistory = async () => {
    try {
      const token = localStorage.getItem('dashboardToken');
      const response = await axios.get('http://localhost:3001/api/sent-history', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setSentHistory(response.data);
    } catch (error) {
      console.error('Error fetching sent history:', error);
    }
  };

  const handleApprove = async (type, id) => {
    setLoadingApprove({ type, id });
    
    try {
      const response = await fetch('http://localhost:3001/api/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, id })
      });
      
      const result = await response.json();
      
      if (result.success) {
        if (type === 'reply') {
          setReplies(replies.filter(r => r.id !== id));
        } else if (type === 'connection') {
          setConnections(connections.filter(c => c.id !== id));
        } else if (type === 'job') {
          setJobs(jobs.filter(j => j.id !== id));
        } else if (type === 'post') {
          setPosts(posts.filter(p => p.id !== id));
        }
        
        showNotification(`✓ ${result.message}`);
      } else {
        showNotification(`✗ ${result.message || 'Failed to send'}`);
      }
    } catch (error) {
      console.error('Error approving:', error);
      showNotification('Failed to approve and send');
    } finally {
      setLoadingApprove(null);
    }
  };

  const handleReject = async (type, id) => {
    try {
      await axios.post('http://localhost:3001/api/dismiss', { type, id });
      
      if (type === 'reply') setReplies(replies.filter(item => item.id !== id));
      if (type === 'connection') setConnections(connections.filter(item => item.id !== id));
      if (type === 'post') setPosts(posts.filter(item => item.id !== id));
      
      showNotification(`${type.charAt(0).toUpperCase() + type.slice(1)} dismissed`);
    } catch (error) {
      console.error(`Error dismissing ${type}:`, error);
      showNotification('Failed to dismiss');
    }
  };

  const handleRegenerate = async (type, id, customPrompt = '') => {
    setRegenerating(prev => ({ ...prev, [id]: true }));
    
    try {
      const response = await fetch('http://localhost:3001/api/regenerate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, id, customPrompt })
      });
      
      const result = await response.json();
      
      if (result.success) {
        if (type === 'reply') {
          setReplies(prev => prev.map(item =>
            item.id === id ? { ...item, draft_text: result.newDraft } : item
          ));
        } else if (type === 'connection') {
          setConnections(prev => prev.map(item =>
            item.id === id ? { ...item, draft_note: result.newDraft } : item
          ));
        } else if (type === 'post') {
          setPosts(prev => prev.map(item =>
            item.id === id ? { ...item, draft_text: result.newDraft } : item
          ));
        }
        showNotification('Draft regenerated successfully! ✓');
        setCustomPrompts(prev => ({ ...prev, [id]: '' }));
        setShowPromptInput(prev => ({ ...prev, [id]: false }));
      }
    } catch (error) {
      console.error('Error regenerating:', error);
      showNotification('Failed to regenerate draft');
    } finally {
      setRegenerating(prev => ({ ...prev, [id]: false }));
    }
  };

  const handleJobSearch = async () => {
    if (!jobSearchKeywords.trim()) {
      showNotification('Please enter keywords');
      return;
    }

    setSearchingJobs(true);
    
    try {
      const response = await fetch('http://localhost:3001/api/jobs/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          keywords: jobSearchKeywords, 
          location: jobSearchLocation 
        })
      });
      
      const result = await response.json();
      
      if (result.success) {
        setJobs(result.jobs);
        showNotification(result.message);
      } else {
        showNotification('Search failed');
      }
    } catch (error) {
      console.error('Error searching jobs:', error);
      showNotification('Failed to search jobs');
    } finally {
      setSearchingJobs(false);
    }
  };

  const handleGeneratePost = async () => {
    setGeneratingPost(true);
    
    try {
      const response = await fetch('http://localhost:3001/api/posts/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: postTopic })
      });
      
      const result = await response.json();
      
      if (result.success) {
        setPosts(prev => [result.post, ...prev]);
        showNotification(result.message);
        setPostTopic('');
      } else {
        showNotification('Generation failed');
      }
    } catch (error) {
      console.error('Error generating post:', error);
      showNotification('Failed to generate post');
    } finally {
      setGeneratingPost(false);
    }
  };

  const checkPresence = async () => {
    try {
      const response = await fetch('http://localhost:3001/api/presence');
      const data = await response.json();
      setPresenceOnline(data.online);
    } catch (error) {
      console.error('Failed to check presence:', error);
    }
  };

  useEffect(() => {
    checkPresence();
    const presenceInterval = setInterval(checkPresence, 60000);
    return () => clearInterval(presenceInterval);
  }, []);

  const showNotification = (message, type = 'info') => {
    setNotification(message);
    setTimeout(() => setNotification(''), 3000);
  };

  // ADD LOGOUT HANDLER
  const handleLogout = () => {
    localStorage.removeItem('dashboardToken');
    window.location.reload();
  };

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  const stats = {
    pendingMessages: replies.length,  // Changed from pendingReplies
    pendingConnections: connections.length,
    jobMatches: jobs.length,
    pendingPosts: posts.length
  };

  return (
    <div className="app">
      <header>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1>LinkedIn Assistant Dashboard</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '0.5rem',
              fontSize: '0.9rem',
              color: '#fff'
            }}>
              <span style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: presenceOnline ? '#10b981' : '#6b7280'
              }}></span>
              {presenceOnline ? 'Active' : 'Inactive'}
            </div>
            {/* ADD LOGOUT BUTTON */}
            <button 
              onClick={handleLogout}
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
        </div>
      </header>

      {notification && <div className="notification">{notification}</div>}

      <main>
        <div className="stats-grid">
          <div className="stat-card">
            <h3>Pending Messages</h3>
            <p className="stat-number">{replies.length}</p>
          </div>
          <div className="stat-card">
            <h3>Pending Connections</h3>
            <p className="stat-number">{connections.length}</p>
          </div>
          <div className="stat-card">
            <h3>Job Matches</h3>
            <p className="stat-number">{jobs.length}</p>
          </div>
          <div className="stat-card">
            <h3>Pending Posts</h3>
            <p className="stat-number">{posts.length}</p>
          </div>
        </div>

        <nav className="tabs">
          <button
            onClick={() => setActiveTab('replies')}
            className={activeTab === 'replies' ? 'tab active' : 'tab'}
          >
            Messages ({replies.length})
          </button>
          <button
            onClick={() => setActiveTab('connections')}
            className={activeTab === 'connections' ? 'tab active' : 'tab'}
          >
            Connections ({connections.length})
          </button>
          <button
            onClick={() => setActiveTab('jobs')}
            className={activeTab === 'jobs' ? 'tab active' : 'tab'}
          >
            Job Search ({jobs.length})
          </button>
          <button
            onClick={() => setActiveTab('posts')}
            className={activeTab === 'posts' ? 'tab active' : 'tab'}
          >
            Generate Post ({posts.length})
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={activeTab === 'history' ? 'tab active' : 'tab'}
          >
            Sent History ({sentHistory.length})
          </button>
          <button
            onClick={() => setActiveTab('targets')}
            className={activeTab === 'targets' ? 'tab active' : 'tab'}
          >
            Targets
          </button>
          {/* ADD THIS NEW BUTTON */}
          <button
            onClick={() => setActiveTab('settings')}
            className={activeTab === 'settings' ? 'tab active' : 'tab'}
          >
            Account Settings
          </button>
        </nav>

        <div className="tab-content">
          {activeTab === 'replies' && (
            <MessageReplyTab  
              replies={replies} 
              onApprove={handleApprove}
              onReject={handleReject}
              onRegenerate={handleRegenerate}
              regenerating={regenerating}
              customPrompts={customPrompts}
              showPromptInput={showPromptInput}
              setCustomPrompts={setCustomPrompts}
              setShowPromptInput={setShowPromptInput}
              loadingApprove={loadingApprove}
            />
          )}
          {activeTab === 'connections' && (
            <ConnectionRequestTab 
              connections={connections} 
              onApprove={handleApprove}
              onReject={handleReject}
              onRegenerate={handleRegenerate}
              regenerating={regenerating}
              customPrompts={customPrompts}
              showPromptInput={showPromptInput}
              setCustomPrompts={setCustomPrompts}
              setShowPromptInput={setShowPromptInput}
              loadingApprove={loadingApprove}
            />
          )}
          {activeTab === 'jobs' && (
            <JobSearchTab 
              jobs={jobs}
              keywords={jobSearchKeywords}
              location={jobSearchLocation}
              onKeywordsChange={setJobSearchKeywords}
              onLocationChange={setJobSearchLocation}
              onSearch={handleJobSearch}
              searching={searchingJobs}
              onApprove={handleApprove}
              loadingApprove={loadingApprove}
            />
          )}
          {activeTab === 'posts' && (
            <ContentPostTab 
              posts={posts}
              topic={postTopic}
              onTopicChange={setPostTopic}
              onGenerate={handleGeneratePost}
              generating={generatingPost}
              onApprove={handleApprove}
              onReject={handleReject}
              onRegenerate={handleRegenerate}
              regenerating={regenerating}
              customPrompts={customPrompts}
              showPromptInput={showPromptInput}
              setCustomPrompts={setCustomPrompts}
              setShowPromptInput={setShowPromptInput}
              loadingApprove={loadingApprove}
            />
          )}
          {activeTab === 'history' && <HistoryTab history={sentHistory} />}
          {activeTab === 'targets' && <TargetsTab />}
          {activeTab === 'settings' && <AccountSettings onLogout={handleLogout} />}
        </div>
      </main>
    </div>
  );
}

// ALL TAB COMPONENTS STAY EXACTLY THE SAME
const MessageReplyTab = ({ 
  replies, 
  onApprove, 
  onReject,
  onRegenerate,
  regenerating,
  customPrompts,
  showPromptInput,
  setCustomPrompts,
  setShowPromptInput,
  loadingApprove 
}) => (
  <section className="section">
    <h2>Pending Messages</h2>
    {replies.length === 0 ? (
      <p className="empty-state">No pending messages</p>
    ) : (
      <div className="cards">
        {replies.map((reply) => (
          <div key={reply.id} className="card">
            <div className="card-header">
              <h3>Reply to {reply.participant_name || 'Unknown'}</h3>
              <span className="date">
                {new Date(reply.created_at).toLocaleDateString()}
              </span>
            </div>
            <div className="card-body">
              <p className="draft-text">{reply.draft_text}</p>
            </div>
            <div className="card-actions">
              <button
                className="btn btn-approve"
                onClick={() => onApprove('reply', reply.id)}
                disabled={loadingApprove?.type === 'reply' && loadingApprove?.id === reply.id}
              >
                {loadingApprove?.type === 'reply' && loadingApprove?.id === reply.id 
                  ? 'Sending...' 
                  : 'Approve & Send'}
              </button>
              <button 
                className="btn btn-regenerate"
                onClick={() => setShowPromptInput(prev => ({ ...prev, [reply.id]: !prev[reply.id] }))}
                disabled={regenerating[reply.id]}
              >
                {regenerating[reply.id] ? 'Regenerating...' : 'Regenerate'}
              </button>
              <button 
                className="btn btn-reject"
                onClick={() => onReject('reply', reply.id)}
              >
                Reject
              </button>
            </div>
            {showPromptInput[reply.id] && (
              <div className="custom-prompt-section">
                <input
                  type="text"
                  className="custom-prompt-input"
                  placeholder="Optional: Add custom instructions..."
                  value={customPrompts[reply.id] || ''}
                  onChange={(e) => setCustomPrompts(prev => ({ ...prev, [reply.id]: e.target.value }))}
                />
                <button 
                  className="btn btn-regenerate-confirm"
                  onClick={() => onRegenerate('reply', reply.id, customPrompts[reply.id])}
                  disabled={regenerating[reply.id]}
                >
                  Confirm
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    )}
  </section>
);

const ConnectionRequestTab = ({ 
  connections, 
  onApprove, 
  onReject,
  onRegenerate,
  regenerating,
  customPrompts,
  showPromptInput,
  setCustomPrompts,
  setShowPromptInput,
  loadingApprove 
}) => (
  <section className="section">
    <h2>Pending Connections</h2>
    {connections.length === 0 ? (
      <p className="empty-state">No pending connections</p>
    ) : (
      <div className="cards">
        {connections.map((connection) => (
          <div key={connection.id} className="card">
            <div className="card-header">
              <h3>{connection.name}</h3>
              <span className="date">
                {new Date(connection.drafted_at).toLocaleDateString()}
              </span>
            </div>
            <div className="card-body">
              <p className="headline">{connection.headline}</p>
              {connection.profile_url && (
                <a 
                  href={connection.profile_url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="profile-link"
                >
                  View Profile →
                </a>
              )}
              {connection.draft_note && (
                <div className="draft-note">
                  <strong>Connection Note:</strong>
                  <p>{connection.draft_note}</p>
                </div>
              )}
            </div>
            <div className="card-actions">
              <button
                className="btn btn-approve"
                onClick={() => onApprove('connection', connection.id)}
                disabled={loadingApprove?.type === 'connection' && loadingApprove?.id === connection.id}
              >
                {loadingApprove?.type === 'connection' && loadingApprove?.id === connection.id 
                  ? 'Sending...' 
                  : 'Approve & Send'}
              </button>
              <button 
                className="btn btn-regenerate"
                onClick={() => setShowPromptInput(prev => ({ ...prev, [connection.id]: !prev[connection.id] }))}
                disabled={regenerating[connection.id]}
              >
                {regenerating[connection.id] ? 'Regenerating...' : 'Regenerate Note'}
              </button>
              <button 
                className="btn btn-reject"
                onClick={() => onReject('connection', connection.id)}
              >
                Reject
              </button>
            </div>
            {showPromptInput[connection.id] && (
              <div className="custom-prompt-section">
                <input
                  type="text"
                  className="custom-prompt-input"
                  placeholder="Optional: Add custom instructions..."
                  value={customPrompts[connection.id] || ''}
                  onChange={(e) => setCustomPrompts(prev => ({ ...prev, [connection.id]: e.target.value }))}
                />
                <button 
                  className="btn btn-regenerate-confirm"
                  onClick={() => onRegenerate('connection', connection.id, customPrompts[connection.id])}
                  disabled={regenerating[connection.id]}
                >
                  Confirm
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    )}
  </section>
);

const JobSearchTab = ({ jobs, keywords, location, onKeywordsChange, onLocationChange, onSearch, searching, onApprove, loadingApprove }) => (
  <section className="section">
    <h2>Job Search</h2>
    
    <div className="search-form">
      <div className="search-inputs">
        <input
          type="text"
          className="search-input"
          placeholder="Keywords (e.g., Software Engineer, Product Manager)"
          value={keywords}
          onChange={(e) => onKeywordsChange(e.target.value)}
        />
        <input
          type="text"
          className="search-input"
          placeholder="Location (e.g., San Francisco, Remote)"
          value={location}
          onChange={(e) => onLocationChange(e.target.value)}
        />
        <button
          className="btn btn-search"
          onClick={onSearch}
          disabled={searching}
        >
          {searching ? 'Searching...' : 'Search'}
        </button>
      </div>
    </div>

    {jobs.length === 0 ? (
      <p className="empty-state">No job matches. Try searching above.</p>
    ) : (
      <div className="cards">
        {jobs.map((job) => (
          <div key={job.id} className="card">
            <div className="card-header">
              <div>
                <h3>{job.job_title || job.title || 'Job Title Not Available'}</h3>
                <p className="company-name">{job.company_name || job.company || 'Company Not Listed'}</p>
                <p className="job-location">📍 {job.location || 'Location not specified'}</p>
              </div>
              <span className="match-badge">{job.match_score}% Match</span>
            </div>
            <div className="card-body">
              {job.job_url && (
                <a 
                  href={job.job_url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="job-link"
                >
                  View Job →
                </a>
              )}
            </div>
            <div className="card-actions">
              <button
                className="btn btn-approve"
                onClick={() => onApprove('job', job.id)}
                disabled={loadingApprove?.type === 'job' && loadingApprove?.id === job.id}
              >
                {loadingApprove?.type === 'job' && loadingApprove?.id === job.id 
                  ? 'Marking...' 
                  : 'Mark as Applied'}
              </button>
            </div>
          </div>
        ))}
      </div>
    )}
  </section>
);

const ContentPostTab = ({ 
  posts, 
  topic,
  onTopicChange,
  onGenerate, 
  generating, 
  onApprove,
  onReject,
  onRegenerate,
  regenerating,
  customPrompts,
  showPromptInput,
  setCustomPrompts,
  setShowPromptInput,
  loadingApprove 
}) => (
  <section className="section">
    <h2>Generate Post</h2>
    
    <div className="search-form">
      <div className="search-inputs">
        <input
          type="text"
          className="search-input"
          placeholder="Optional: Enter a topic (or leave blank for profile-based post)"
          value={topic}
          onChange={(e) => onTopicChange(e.target.value)}
        />
        <button
          className="btn btn-search"
          onClick={onGenerate}
          disabled={generating}
        >
          {generating ? 'Generating...' : 'Generate'}
        </button>
      </div>
      <p className="form-hint">
        Leave topic blank to generate a post based on your profile and experience
      </p>
    </div>

    {posts.length === 0 ? (
      <p className="empty-state">No pending posts. Generate one above!</p>
    ) : (
      <div className="cards">
        {posts.map((post) => (
          <div key={post.id} className="card">
            <div className="card-header">
              <h3>{post.topic}</h3>
              <span className="date">
                {new Date(post.created_at).toLocaleDateString()}
              </span>
            </div>
            <div className="card-body">
              <p className="draft-text">{post.draft_text}</p>
            </div>
            <div className="card-actions">
              <button
                className="btn btn-approve"
                onClick={() => onApprove('post', post.id)}
                disabled={loadingApprove?.type === 'post' && loadingApprove?.id === post.id}
              >
                {loadingApprove?.type === 'post' && loadingApprove?.id === post.id 
                  ? 'Publishing...' 
                  : 'Approve & Publish'}
              </button>
              <button 
                className="btn btn-regenerate"
                onClick={() => setShowPromptInput(prev => ({ ...prev, [post.id]: !prev[post.id] }))}
                disabled={regenerating[post.id]}
              >
                {regenerating[post.id] ? 'Regenerating...' : 'Regenerate'}
              </button>
              <button 
                className="btn btn-reject"
                onClick={() => onReject('post', post.id)}
              >
                Reject
              </button>
            </div>
            {showPromptInput[post.id] && (
              <div className="custom-prompt-section">
                <input
                  type="text"
                  className="custom-prompt-input"
                  placeholder="Optional: Add custom instructions..."
                  value={customPrompts[post.id] || ''}
                  onChange={(e) => setCustomPrompts(prev => ({ ...prev, [post.id]: e.target.value }))}
                />
                <button 
                  className="btn btn-regenerate-confirm"
                  onClick={() => onRegenerate('post', post.id, customPrompts[post.id])}
                  disabled={regenerating[post.id]}
                >
                  Confirm
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    )}
  </section>
);

const HistoryTab = ({ history }) => (
  <section className="section">
    <h2>Sent History</h2>
    {history.length === 0 ? (
      <p className="empty-state">No sent items yet</p>
    ) : (
      <div className="cards">
        {history.map((item, index) => (
          <div key={index} className="card">
            <div className="card-header">
              <div>
                <h3>
                  {item.type === 'message' && `Message to ${item.participant_name || 'Unknown'}`}
                  {item.type === 'connection' && `Connection: ${item.participant_name || 'Unknown'}`}
                  {item.type === 'post' && `Post: ${item.participant_name || 'Untitled'}`}
                  {item.type === 'job' && `Job Application`}
                </h3>
                {item.type === 'job' && (
                  <p className="company-name">
                    {item.participant_name || 'Unknown Title'} at {item.draft_text || 'Unknown Company'}
                  </p>
                )}
              </div>
              <span className="date">
                {new Date(item.sent_at).toLocaleDateString()}
              </span>
            </div>
            <div className="card-body">
              {(item.type === 'message' || item.type === 'connection' || item.type === 'post') && item.draft_text && (
                <p className="draft-text">{item.draft_text}</p>
              )}
            </div>
            <div className="sent-badge">✓ Sent</div>
          </div>
        ))}
      </div>
    )}
  </section>
);

export default App;