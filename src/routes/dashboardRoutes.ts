import express from 'express';
import { supabase } from '../services/supabaseClient';

const router = express.Router();

router.get('/business-info', async (req, res) => {
  const { data, error } = await supabase.from('business_info').select('*').limit(1).single();
  if (error && error.code !== 'PGRST116') { // PGRST116 is "no rows returned"
    return res.status(500).json({ error: error.message });
  }
  res.json(data || {});
});

router.post('/business-info', async (req, res) => {
  const { business_name, description, hours, contact_info, greetings } = req.body;
  
  // Check if exists
  const { data: existing } = await supabase.from('business_info').select('id').limit(1).single();

  let result;
  if (existing) {
    result = await supabase
      .from('business_info')
      .update({ business_name, description, hours, contact_info, greetings })
      .eq('id', existing.id)
      .select();
  } else {
    result = await supabase
      .from('business_info')
      .insert({ business_name, description, hours, contact_info, greetings })
      .select();
  }

  if (result.error) {
    return res.status(500).json({ error: result.error.message });
  }
  res.json(result.data[0]);
});

export default router;

