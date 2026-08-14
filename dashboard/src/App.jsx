import { useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';

function App() {
  const [activeTab, setActiveTab] = useState('replies');
  const [replies, setReplies] = useState([]);
  const [connections, setConnections] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notification, setNotification] = useState('');

  useEffect(() => {
    fetchPendingItems();
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

  const handleApprove = async (type, id) => {
    try {
      await axios.post('http://localhost:3001/api/approve', { type, id });
      
      if (type === 'reply') setReplies(replies.filter(item => item.id !== id));
      if (type === 'connection') setConnections(connections.filter(item => item.id !== id));
      if (type === 'job') setJobs(jobs.filter(item => item.id !== id));
      if (type === 'post') setPosts(posts.filter(item => item.id !== id));
      
      showNotification(`${type.charAt(0).toUpperCase() + type.slice(1)} approved ✓`);
    } catch (error) {
      console.error(`Error approving ${type}:`, error);
      showNotification('Failed to approve');
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

  const showNotification = (message) => {
    setNotification(message);
    setTimeout(() => setNotification(''), 3000);
  };

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  return (
    <div className="app">
      <header>
        <h1>LinkedIn Assistant Dashboard</h1>
      </header>

      <nav className="tabs">
        <button 
          className={activeTab === 'replies' ? 'tab active' : 'tab'}
          onClick={() => setActiveTab('replies')}
        >
          Replies ({replies.length})
        </button>
        <button 
          className={activeTab === 'connections' ? 'tab active' : 'tab'}
          onClick={() => setActiveTab('connections')}
        >
          Connections ({connections.length})
        </button>
        <button 
          className={activeTab === 'jobs' ? 'tab active' : 'tab'}
          onClick={() => setActiveTab('jobs')}
        >
          Jobs ({jobs.length})
        </button>
        <button 
          className={activeTab === 'posts' ? 'tab active' : 'tab'}
          onClick={() => setActiveTab('posts')}
        >
          Posts ({posts.length})
        </button>
      </nav>

      <main>
        {notification && (
          <div className="notification">{notification}</div>
        )}

        {/* REPLIES SECTION */}
        {activeTab === 'replies' && (
          <section className="section">
            <h2>Pending Replies</h2>
            {replies.length === 0 ? (
              <p className="empty-state">No pending replies</p>
            ) : (
              <div className="cards">
                {replies.map((reply) => (
                  <div key={reply.id} className="card">
                    <div className="card-header">
                      <h3>{reply.participant_name}</h3>
                      <span className="timestamp">
                        {new Date(reply.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="card-body">
                      <p className="draft-text">{reply.draft_text}</p>
                    </div>
                    <div className="card-actions">
                      <button
                        className="btn btn-approve"
                        onClick={() => handleApprove('reply', reply.id)}
                      >
                        Approve
                      </button>
                      <button
                        className="btn btn-reject"
                        onClick={() => handleReject('reply', reply.id)}
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* CONNECTIONS SECTION */}
        {activeTab === 'connections' && (
          <section className="section">
            <h2>Pending Connection Requests</h2>
            {connections.length === 0 ? (
              <p className="empty-state">No pending connection requests</p>
            ) : (
              <div className="cards">
                {connections.map((conn) => (
                  <div key={conn.id} className="card">
                    <div className="card-header">
                      <h3>{conn.name}</h3>
                      <span className="timestamp">
                        {new Date(conn.drafted_at).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="card-body">
                      <p className="headline">{conn.headline}</p>
                      {conn.profile_url && (
                        <a 
                          href={conn.profile_url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="profile-link"
                        >
                          View Profile →
                        </a>
                      )}
                      {conn.draft_note && (
                        <div className="note-section">
                          <strong>Connection Note:</strong>
                          <p className="draft-text">{conn.draft_note}</p>
                        </div>
                      )}
                    </div>
                    <div className="card-actions">
                      <button
                        className="btn btn-approve"
                        onClick={() => handleApprove('connection', conn.id)}
                      >
                        Approve
                      </button>
                      <button
                        className="btn btn-reject"
                        onClick={() => handleReject('connection', conn.id)}
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* JOBS SECTION */}
        {activeTab === 'jobs' && (
          <section className="section">
            <h2>Job Matches (Score ≥ 70)</h2>
            {jobs.length === 0 ? (
              <p className="empty-state">No job matches found</p>
            ) : (
              <div className="cards">
                {jobs.map((job) => (
                  <div key={job.id} className="card">
                    <div className="card-header">
                      <h3>{job.title}</h3>
                      <span className="match-score">
                        {job.match_score}% Match
                      </span>
                    </div>
                    <div className="card-body">
                      <p className="company">{job.company}</p>
                      {job.job_url && (
                        <a 
                          href={job.job_url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="profile-link"
                        >
                          View Job →
                        </a>
                      )}
                    </div>
                    <div className="card-actions">
                      <button
                        className="btn btn-approve"
                        onClick={() => handleApprove('job', job.id)}
                      >
                        Approve
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* POSTS SECTION */}
        {activeTab === 'posts' && (
          <section className="section">
            <h2>Pending Posts</h2>
            {posts.length === 0 ? (
              <p className="empty-state">No pending posts</p>
            ) : (
              <div className="cards">
                {posts.map((post) => (
                  <div key={post.id} className="card">
                    <div className="card-header">
                      <h3>{post.topic}</h3>
                      <span className="timestamp">
                        {new Date(post.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="card-body">
                      <p className="draft-text">{post.draft_text}</p>
                    </div>
                    <div className="card-actions">
                      <button
                        className="btn btn-approve"
                        onClick={() => handleApprove('post', post.id)}
                      >
                        Approve
                      </button>
                      <button
                        className="btn btn-reject"
                        onClick={() => handleReject('post', post.id)}
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

export default App;