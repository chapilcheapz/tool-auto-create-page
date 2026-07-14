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
    let user = await userService.findUserByUsername(username);
    if (!user) {
      user = await userService.findUserByEmail(username);
    }

    if (!user) {
      return res.status(401).json({ success: false, error: 'Tài khoản hoặc mật khẩu không chính xác.' });
    }

    if (user.role !== 'admin') {
      return res.status(401).json({ success: false, error: 'Tài khoản không có quyền đăng nhập hệ thống.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, error: 'Tài khoản hoặc mật khẩu không chính xác.' });
    }

    // Load custom JWT expiration from environment (e.g. 15m)
    const expiresIn = process.env.JWT_EXPIRES_IN || '15m';
    const displayUsername = user.username || user.email;
    const token = jwt.sign(
      { username: displayUsername },
      getJwtSecret(),
      { expiresIn }
    );

    // Sign Refresh Token using JWT_SECRET + user.password (Security seed)
    const refreshSecret = getJwtSecret() + user.password;
    const refreshExpiresIn = process.env.REFRESH_TOKEN_EXPIRES_DAYS ? `${process.env.REFRESH_TOKEN_EXPIRES_DAYS}d` : '30d';
    const refreshToken = jwt.sign(
      { username: displayUsername },
      refreshSecret,
      { expiresIn: refreshExpiresIn }
    );

    return res.json({
      success: true,
      token,
      refreshToken,
      user: {
        username: displayUsername
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

    const isMatch = await bcrypt.compare(currentPassword, user.password);
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

async function refresh(req, res) {
  const { refreshToken } = req.body;
  console.log('[JWT-Refresh-Debug] Nhận yêu cầu refresh. Token length:', refreshToken ? refreshToken.length : 0);
  if (!refreshToken) {
    return res.status(400).json({ success: false, error: 'Thiếu Refresh Token.' });
  }

  try {
    // Decode without verification first to extract payload (username)
    const decodedPayload = jwt.decode(refreshToken);
    console.log('[JWT-Refresh-Debug] Decoded payload:', decodedPayload);
    if (!decodedPayload || !decodedPayload.username) {
      return res.status(401).json({ success: false, error: 'Refresh Token không hợp lệ.' });
    }

    const username = decodedPayload.username;
    
    // Fetch user from DB to get current password hash for verifying signature (check both username and email)
    let user = await userService.findUserByUsername(username);
    if (!user) {
      user = await userService.findUserByEmail(username);
    }
    console.log('[JWT-Refresh-Debug] Tìm thấy user từ DB:', user ? { id: user.id, username: user.username } : 'null');
    if (!user) {
      return res.status(401).json({ success: false, error: 'Người dùng không tồn tại.' });
    }

    // Verify signature using JWT_SECRET + user.password (Security seed)
    const refreshSecret = getJwtSecret() + user.password;
    console.log('[JWT-Refresh-Debug] Đang verify chữ ký...');
    
    let decoded;
    try {
      decoded = jwt.verify(refreshToken, refreshSecret);
      console.log('[JWT-Refresh-Debug] Verify chữ ký THÀNH CÔNG!');
    } catch (err) {
      console.error('[JWT-Refresh-Debug] Lỗi verify refresh token:', err.message, err.stack);
      return res.status(401).json({ success: false, error: 'Phiên đăng nhập đã hết hạn hoặc mật khẩu đã thay đổi. Vui lòng đăng nhập lại.' });
    }



    // Issue new Access Token
    const expiresIn = process.env.JWT_EXPIRES_IN || '15m';
    const token = jwt.sign(
      { username: decoded.username },
      getJwtSecret(),
      { expiresIn }
    );

    // Issue new Refresh Token (Rotation)
    const refreshExpiresIn = process.env.REFRESH_TOKEN_EXPIRES_DAYS ? `${process.env.REFRESH_TOKEN_EXPIRES_DAYS}d` : '30d';
    const newRefreshToken = jwt.sign(
      { username: decoded.username },
      refreshSecret,
      { expiresIn: refreshExpiresIn }
    );

    return res.json({
      success: true,
      token,
      refreshToken: newRefreshToken
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}

module.exports = {
  login,
  changePassword,
  register,
  refresh
};
