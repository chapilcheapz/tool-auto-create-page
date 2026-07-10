const supabase = require('../utils/supabase');

async function readConfig() {
  try {
    const { data, error } = await supabase
      .from('configs')
      .select('value')
      .eq('key', 'cookie')
      .single();
    
    if (error) {
      if (error.code === 'PGRST116') {
        return { cookie: '' };
      }
      throw error;
    }
    
    return { cookie: data ? data.value : '' };
  } catch (e) {
    return { cookie: '' };
  }
}

async function writeConfig(cookieValue) {
  try {
    const { error } = await supabase
      .from('configs')
      .upsert({ key: 'cookie', value: cookieValue || '', updated_at: new Date().toISOString() });
    
    if (error) throw error;
    return { success: true };
  } catch (e) {
    throw new Error('Không thể lưu cấu hình lên Supabase: ' + e.message);
  }
}

function getJwtSecret() {
  return process.env.JWT_SECRET || 'fallback_super_secret_key_12345';
}

module.exports = {
  readConfig,
  writeConfig,
  getJwtSecret
};
