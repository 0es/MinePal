import { useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';
import Login from './components/Login';
import Settings from './components/Settings';
import Profiles from './components/Profiles';
import Actions from './components/Actions';
import Transcription from './components/Transcription';

const api = axios.create({
  baseURL: LOCAL_BE_HOST
});

function App() {
  const [settings, setSettings] = useState({
    minecraft_version: "",
    host: "",
    port: "",
    player_username: "",
    auth: "",
    profiles: [],
    load_memory: false,
    init_message: "",
    allow_insecure_coding: false,
    code_timeout_mins: "",
  });

  const [error, setError] = useState(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [socket, setSocket] = useState(null);
  const [microphone, setMicrophone] = useState(null);
  const [transcription, setTranscription] = useState("");
  const [agentStarted, setAgentStarted] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [newProfile, setNewProfile] = useState("");

  const [loading, setLoading] = useState(true);

  const addProfile = () => {
    if (newProfile.trim() !== "") {
      setSettings(prev => ({
        ...prev,
        profiles: [...prev.profiles, newProfile.trim()]
      }));
      setNewProfile("");
    }
  };

  const removeProfile = (index) => {
    setSettings(prev => ({
      ...prev,
      profiles: prev.profiles.filter((_, i) => i !== index)
    }));
  };

  useEffect(() => {
    const checkCredentials = () => {
      const storedUsername = localStorage.getItem('username');
      const storedPassword = localStorage.getItem('password');
      if (storedUsername && storedPassword) {
        setUsername(storedUsername);
        setPassword(storedPassword);
        setIsLoggedIn(true);
        fetchDataWithRetry(storedUsername, storedPassword);
      } else {
        setLoading(false);
      }
    };

    const fetchDataWithRetry = async (user, pass) => {
      const startTime = Date.now();
      const timeoutDuration = 5000;

      while (Date.now() - startTime < timeoutDuration) {
        try {
          await fetchSettings(user, pass);
          await fetchAgentStatus(user, pass);
          setError(null);
          break; // Exit loop if both fetches succeed
        } catch (err) {
          console.error("Fetch failed, retrying...", err);
          await new Promise(resolve => setTimeout(resolve, 500)); // Wait before retrying
        }
      }

      setLoading(false);
    };

    checkCredentials();
  }, []);

  const settingNotes = {
    minecraft_version: "supports up to 1.20.4",
    host: "or \"localhost\", \"your.ip.address.here\"",
    port: "default is 25565",
    player_username: "your Minecraft username",
    auth: "or \"microsoft\"",
    profiles: "add more profiles here, check ./profiles/ for more. More than 1 profile will require you to /msg each bot individually",
    load_memory: "load memory from previous session",
    init_message: "sends to all on spawn",
    allow_insecure_coding: "disable at own risk",
    code_timeout_mins: "-1 for no timeout",
  }

  const fetchSettings = async (user, pass) => {
    try {
      const response = await api.get('/settings', {
        auth: {
          username: user,
          password: pass
        }
      });
      const expectedFields = Object.keys(settings);
      const filteredSettings = Object.fromEntries(
        Object.entries(response.data).filter(([key]) => expectedFields.includes(key))
      );
      setSettings(prevSettings => ({ ...prevSettings, ...filteredSettings }));
    } catch (err) {
      console.error("Failed to fetch settings:", err);
      setError("Failed to load settings.");
      throw err;
    }
  };

  const fetchAgentStatus = async (user, pass) => {
    try {
      const response = await api.get('/agent-status', {
        auth: {
          username: user,
          password: pass
        }
      });
      setAgentStarted(response.data.agentStarted);
    } catch (err) {
      console.error("Failed to fetch agent status:", err);
      setError("Failed to load agent status.");
      throw err;
    }
  };

  const handleLogin = (e) => {
    e.preventDefault();
    localStorage.setItem('username', username);
    localStorage.setItem('password', password);
    // TODO: verify credentials
    setIsLoggedIn(true);
    setLoading(true);
    fetchSettings(username, password);
    fetchAgentStatus(username, password);
  };

  const handleSettingChange = (key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const toggleAgent = async () => {
    if (agentStarted) {
      try {
        const response = await api.post('/stop', {}, {
          auth: {
            username,
            password
          }
        });
        console.log("Agent stopped successfully:", response.data);
        setAgentStarted(false);
      } catch (error) {
        console.error("Failed to stop agent:", error);
        setError(error.response?.data || error.message || "An unknown error occurred while stopping the agent.");
      }
    } else {
      const emptyFields = Object.entries(settings)
        .filter(([key, value]) => {
          if (key === 'profiles') return value.length === 0;
          if (typeof value === 'string') return value.trim() === '';
          if (Array.isArray(value)) return value.length === 0;
          return value === null || value === undefined;
        })
        .map(([key]) => key);

      if (emptyFields.length > 0) {
        setError(`Please fill in the following fields: ${emptyFields.join(', ')}`);
        return;
      }

      try {
        const response = await api.post('/start', settings, {
          auth: {
            username,
            password
          }
        });
        console.log("Agent started successfully:", response.data);
        setAgentStarted(true);
      } catch (error) {
        console.error("Failed to start agent:", error);
        setError(error.response?.data || error.message || "An unknown error occurred while starting the agent.");
      }
    }
  };

  const getMicrophone = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      return new MediaRecorder(stream);
    } catch (error) {
      console.error("Error accessing microphone:", error);
      throw error;
    }
  };

  const openMicrophone = async (mic, sock) => {
    return new Promise((resolve) => {
      mic.onstart = () => {
        console.log("Microphone started");
        setIsRecording(true);
        resolve();
      };

      mic.onstop = () => {
        console.log("Microphone stopped");
        setIsRecording(false);
      };

      mic.ondataavailable = (event) => {
        if (event.data.size > 0 && sock.readyState === WebSocket.OPEN) {
          sock.send(event.data);
        }
      };

      mic.start(1000);
    });
  };

  const closeMicrophone = async (mic) => {
    if (mic && mic.state !== "inactive") {
      mic.stop();
    }
  };

  const toggleMic = async () => {
    if (!agentStarted) {
      setError("Please start the agent first.");
      return;
    }

    if (isRecording) {
      await closeMicrophone(microphone);
      if (socket) {
        socket.close();
        setSocket(null);
      }
      setMicrophone(null);
      setIsRecording(false);
    } else {
      const wsUrl = api.defaults.baseURL.replace(/^http/, 'ws');
      const newSocket = new WebSocket(`${wsUrl}`);
      setSocket(newSocket);

      newSocket.addEventListener("open", async () => {
        console.log("WebSocket connection opened");
        try {
          const mic = await getMicrophone();
          setMicrophone(mic);
          await openMicrophone(mic, newSocket);
        } catch (error) {
          console.error("Error opening microphone:", error);
          setError("Failed to start recording. Please check your microphone permissions.");
        }
      });

      newSocket.addEventListener("message", (event) => {
        const data = JSON.parse(event.data);
        if (data.channel.alternatives[0].transcript !== "") {
          setTranscription(data.channel.alternatives[0].transcript);
        }
      });

      newSocket.addEventListener("close", () => {
        console.log("WebSocket connection closed");
        setIsRecording(false);
      });
    }
  };

  if (loading) {
    return <div className="spinner">Loading...</div>;
  }

  if (!isLoggedIn) {
    return (
      <Login
        username={username}
        password={password}
        setUsername={setUsername}
        setPassword={setPassword}
        handleLogin={handleLogin}
      />
    );
  }

  return (
    <div className="container">
      <h1>Minepal Control Panel</h1>
      <Settings
        {...{
          settings,
          handleSettingChange,
          settingNotes,
          showAdvanced,
          setShowAdvanced,
          newProfile,
          setNewProfile,
          addProfile,
          removeProfile
        }}
      />
      <Actions
        agentStarted={agentStarted}
        toggleAgent={toggleAgent}
        isRecording={isRecording}
        toggleMic={toggleMic}
      />
      {error && <div className="error-message">{error}</div>}
      <Transcription transcription={transcription} />
    </div>
  );
}

export default App;