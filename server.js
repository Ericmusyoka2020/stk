const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

// ====================== SUPABASE CLIENTS ======================
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseClient = createClient(supabaseUrl, supabaseAnonKey);
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// ====================== AUTH MIDDLEWARE ======================
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Access token required' });

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) return res.status(403).json({ error: 'Invalid or expired token' });

  req.user = user;
  next();
};

// ====================== HEALTH CHECK ======================
app.get('/', (req, res) => {
  res.json({ 
    message: 'Stock Manager Backend is running on Vercel 🚀',
    status: 'healthy'
  });
});

// ====================== AUTH ROUTES ======================
// Signup
app.post('/api/auth/signup', async (req, res) => {
  const { email, password } = req.body;
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  });
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json({ message: 'Account created successfully! You can now login.' });
});

// Login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) return res.status(400).json({ error: error.message });
  res.json({
    user: data.user,
    access_token: data.session.access_token
  });
});

// Change Password
app.post('/api/auth/change-password', async (req, res) => {
  const { email, new_password } = req.body;
  if (!email || !new_password) return res.status(400).json({ error: 'Email and new password are required' });
  if (new_password.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters long' });

  try {
    const { data: user, error: getError } = await supabaseAdmin.auth.admin.getUserByEmail(email);
    if (getError || !user?.user) return res.status(404).json({ error: 'User not found' });

    const { error } = await supabaseAdmin.auth.admin.updateUserById(user.user.id, { password: new_password });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: 'Password changed successfully!' });
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin Reset Password
app.post('/api/admin/reset-password', async (req, res) => {
  const { email, new_password } = req.body;
  if (!email || !new_password) return res.status(400).json({ error: 'Email and new password are required' });
  if (new_password.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters long' });

  try {
    const { data: users, error: listError } = await supabaseAdmin.auth.admin.listUsers();
    if (listError) return res.status(500).json({ error: 'Failed to list users' });

    const user = users.users.find(u => u.email === email);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { error } = await supabaseAdmin.auth.admin.updateUserById(user.id, { password: new_password });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: 'Password reset successfully!' });
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ====================== INVENTORY ROUTES ======================
app.use('/api/inventory', authenticateToken);

// Get inventory
app.get('/api/inventory', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('inventory')
    .select('*')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Add item
app.post('/api/inventory', async (req, res) => {
  const { item_name, quantity = 0, unit_price } = req.body;
  if (!item_name || unit_price == null) return res.status(400).json({ error: 'Item name and unit price are required' });

  const { data, error } = await supabaseAdmin
    .from('inventory')
    .insert({ user_id: req.user.id, item_name, quantity: Number(quantity), unit_price: Number(unit_price) })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// Update item
app.patch('/api/inventory/:id', async (req, res) => {
  const { id } = req.params;
  const { item_name, quantity, unit_price } = req.body;

  const updateData = {};
  if (item_name !== undefined) updateData.item_name = item_name;
  if (quantity !== undefined) updateData.quantity = Number(quantity);
  if (unit_price !== undefined) updateData.unit_price = Number(unit_price);

  if (Object.keys(updateData).length === 0) return res.status(400).json({ error: 'No fields to update' });

  const { data, error } = await supabaseAdmin
    .from('inventory')
    .update(updateData)
    .eq('id', id)
    .eq('user_id', req.user.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Item not found' });
  res.json(data);
});

// Add stock
app.post('/api/inventory/:id/add', async (req, res) => {
  const { id } = req.params;
  const { amount } = req.body;

  const { data: item } = await supabaseAdmin
    .from('inventory')
    .select('quantity')
    .eq('id', id)
    .eq('user_id', req.user.id)
    .single();

  if (!item) return res.status(404).json({ error: 'Item not found' });

  const newQty = Number(item.quantity) + Number(amount);
  const { data, error } = await supabaseAdmin
    .from('inventory')
    .update({ quantity: newQty })
    .eq('id', id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Sell stock
app.post('/api/inventory/:id/sell', async (req, res) => {
  const { id } = req.params;
  const { amount } = req.body;

  const { data: item } = await supabaseAdmin
    .from('inventory')
    .select('quantity')
    .eq('id', id)
    .eq('user_id', req.user.id)
    .single();

  if (!item) return res.status(404).json({ error: 'Item not found' });
  if (Number(amount) > Number(item.quantity)) return res.status(400).json({ error: 'Not enough stock available' });

  const newQty = Number(item.quantity) - Number(amount);
  const { data, error } = await supabaseAdmin
    .from('inventory')
    .update({ quantity: newQty })
    .eq('id', id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Delete item
app.delete('/api/inventory/:id', async (req, res) => {
  const { id } = req.params;
  const { error } = await supabaseAdmin
    .from('inventory')
    .delete()
    .eq('id', id)
    .eq('user_id', req.user.id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'Item deleted successfully' });
});

// ====================== EXPORT FOR VERCEL ======================
module.exports = app;
