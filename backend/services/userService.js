const bcrypt = require('bcryptjs');
const supabase = require('../utils/supabase');

// Check and initialize default user in the Supabase database
async function initializeUsers() {
  try {
    const { count, error } = await supabase
      .from('app_users')
      .select('*', { count: 'exact', head: true });

    if (error) {
      return;
    }

    if (count === 0) {
      const defaultPasswordHash = bcrypt.hashSync('admin', 10);
      await supabase
        .from('app_users')
        .insert({
          username: 'admin',
          email: 'admin@example.com',
          password: defaultPasswordHash,
          role: 'admin'
        });
    }
  } catch (error) {
    // Silently handle startup initialization errors
  }
}

async function getUsers() {
  try {
    const { data, error } = await supabase
      .from('app_users')
      .select('*');
    if (error) throw error;
    return data || [];
  } catch (error) {
    return [];
  }
}

async function findUserByUsername(username) {
  try {
    if (!username) return null;
    const { data, error } = await supabase
      .from('app_users')
      .select('*')
      .eq('username', username.toLowerCase())
      .maybeSingle();
      
    if (error) throw error;
    return data;
  } catch (error) {
    return null;
  }
}

async function updateUserPassword(username, newPassword) {
  try {
    if (!username) throw new Error('Thiếu tên người dùng');
    
    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(newPassword, salt);
    
    const { error } = await supabase
      .from('app_users')
      .update({ password: passwordHash })
      .eq('username', username.toLowerCase());
      
    if (error) throw error;
    return true;
  } catch (error) {
    throw error;
  }
}

async function findUserByEmail(email) {
  try {
    if (!email) return null;
    const { data, error } = await supabase
      .from('app_users')
      .select('*')
      .eq('email', email.toLowerCase().trim())
      .maybeSingle();
      
    if (error) throw error;
    return data;
  } catch (error) {
    return null;
  }
}

async function createUser(username, email, password) {
  try {
    if (!username || !email || !password) {
      throw new Error('Thiếu tên tài khoản, email hoặc mật khẩu');
    }
    
    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(password, salt);
    
    const { error } = await supabase
      .from('app_users')
      .insert({
        username: username.toLowerCase().trim(),
        email: email.toLowerCase().trim(),
        password: passwordHash
      });
      
    if (error) throw error;
    return true;
  } catch (error) {
    throw error;
  }
}

module.exports = {
  initializeUsers,
  getUsers,
  findUserByUsername,
  findUserByEmail,
  updateUserPassword,
  createUser
};
