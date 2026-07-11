const { createClient } = require('@supabase/supabase-js');
const path = require('path');

// Load environment variables from .env in root directory
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabaseInstance = null;

function getSupabase() {
  if (!supabaseInstance) {
    if (!supabaseUrl || !supabaseServiceKey) {
      console.warn('⚠️ Thiếu cấu hình SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY (Chạy ở chế độ local offline)');
      return null;
    }
    supabaseInstance = createClient(supabaseUrl, supabaseServiceKey);
  }
  return supabaseInstance;
}

module.exports = { getSupabase };

