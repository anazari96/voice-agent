import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Container, TextField, Button, Typography, Box, Paper, Snackbar, Alert } from '@mui/material';

// Assuming backend is on port 3000
const API_URL = 'https://voice-agent-production-0a4f.up.railway.app/api';

interface BusinessInfo {
  business_name: string;
  description: string;
  hours: string;
  contact_info: string;
  greetings: string;
}

function App() {
  const [info, setInfo] = useState<BusinessInfo>({
    business_name: '',
    description: '',
    hours: '',
    contact_info: '',
    greetings: ''
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  useEffect(() => {
    fetchInfo();
  }, []);

  const fetchInfo = async () => {
    try {
      const res = await axios.get(`${API_URL}/business-info`);
      if (res.data && res.data.business_name) {
        setInfo({
          business_name: res.data.business_name,
          description: res.data.description || '',
          hours: res.data.hours || '',
          contact_info: res.data.contact_info || '',
          greetings: res.data.greetings || ''
        });
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInfo({ ...info, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await axios.post(`${API_URL}/business-info`, info);
      setMessage({ type: 'success', text: 'Business Info Saved!' });
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to save info.' });
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container maxWidth="sm">
      <Paper elevation={3} sx={{ p: 4, mt: 4 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          Voice Agent Dashboard
        </Typography>
        <Typography variant="subtitle1" gutterBottom color="textSecondary">
          Configure the business information for your AI Voice Agent.
        </Typography>
        
        <Box component="form" onSubmit={handleSubmit} sx={{ mt: 2 }}>
          <TextField
            fullWidth
            label="Business Name"
            name="business_name"
            value={info.business_name}
            onChange={handleChange}
            margin="normal"
            required
          />
          <TextField
            fullWidth
            label="Description (Context for AI)"
            name="description"
            value={info.description}
            onChange={handleChange}
            margin="normal"
            multiline
            rows={4}
            helperText="Describe what the business does and how the AI should behave."
          />
          <TextField
            fullWidth
            label="Business Hours"
            name="hours"
            value={info.hours}
            onChange={handleChange}
            margin="normal"
          />
          <TextField
            fullWidth
            label="Contact Info"
            name="contact_info"
            value={info.contact_info}
            onChange={handleChange}
            margin="normal"
          />
          <TextField
            fullWidth
            label="Greetings (Said at the beginning of each call)"
            name="greetings"
            value={info.greetings}
            onChange={handleChange}
            margin="normal"
            multiline
            rows={3}
            helperText="This greeting will be spoken automatically when a call starts."
          />
          
          <Button 
            type="submit" 
            variant="contained" 
            color="primary" 
            fullWidth 
            size="large"
            sx={{ mt: 3 }}
            disabled={loading}
          >
            {loading ? 'Saving...' : 'Save Configuration'}
          </Button>
        </Box>
      </Paper>

      <Snackbar open={!!message} autoHideDuration={6000} onClose={() => setMessage(null)}>
        <Alert onClose={() => setMessage(null)} severity={message?.type} sx={{ width: '100%' }}>
          {message?.text}
        </Alert>
      </Snackbar>
    </Container>
  );
}

export default App;
