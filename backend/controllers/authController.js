const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const userService = require('../services/userService');
const { getJwtSecret } = require('../services/configService');

async function login(req, res) {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Vui lòng cung cấp cả tài khoản và mật khẩu.' });
  }

  try {
    const user = await userService.findUserByUsername(username);
    if (!user) {
      return res.status(401).json({ success: false, error: 'Tài khoản hoặc mật khẩu không chính xác.' });
    }

    const isMatch = bcrypt.compareSync(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, error: 'Tài khoản hoặc mật khẩu không chính xác.' });
    }

    // Load custom JWT expiration from environment (e.g. 15m)
    const expiresIn = process.env.JWT_EXPIRES_IN || '15m';
    const token = jwt.sign(
      { username: user.username },
      getJwtSecret(),
      { expiresIn }
    );

    return res.json({
      success: true,
      token,
      user: {
        username: user.username
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}

async function changePassword(req, res) {
  const { currentPassword, newPassword } = req.body;
  const username = req.user && req.user.username;

  if (!username) {
    return res.status(401).json({ success: false, error: 'Chưa xác thực người dùng.' });
  }

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ success: false, error: 'Vui lòng điền mật khẩu hiện tại và mật khẩu mới.' });
  }

  if (newPassword.length < 4) {
    return res.status(400).json({ success: false, error: 'Mật khẩu mới phải dài tối thiểu 4 ký tự.' });
  }

  try {
    const user = await userService.findUserByUsername(username);
    if (!user) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy người dùng.' });
    }

    const isMatch = bcrypt.compareSync(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ success: false, error: 'Mật khẩu hiện tại không chính xác.' });
    }

    await userService.updateUserPassword(username, newPassword);
    return res.json({ success: true, message: 'Thay đổi mật khẩu thành công.' });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}

async function register(req, res) {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ success: false, error: 'Vui lòng cung cấp đầy đủ tài khoản, email và mật khẩu.' });
  }

  // Simple email regex validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ success: false, error: 'Định dạng email không hợp lệ.' });
  }

  if (password.length < 4) {
    return res.status(400).json({ success: false, error: 'Mật khẩu phải dài tối thiểu 4 ký tự.' });
  }

  try {
    const existingUser = await userService.findUserByUsername(username);
    if (existingUser) {
      return res.status(400).json({ success: false, error: 'Tài khoản này đã tồn tại trên hệ thống.' });
    }

    const existingEmail = await userService.findUserByEmail(email);
    if (existingEmail) {
      return res.status(400).json({ success: false, error: 'Email này đã được đăng ký trên hệ thống.' });
    }

    await userService.createUser(username, email, password);
    return res.json({ success: true, message: 'Đăng ký tài khoản thành công.' });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}

module.exports = {
  login,
  changePassword,
  register
};
