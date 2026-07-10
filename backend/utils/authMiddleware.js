const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('../services/configService');

function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  
  if (!authHeader) {
    return res.status(401).json({ success: false, error: 'Yêu cầu đăng nhập để thực hiện tác vụ này.' });
  }

  const tokenParts = authHeader.split(' ');
  if (tokenParts.length !== 2 || tokenParts[0].toLowerCase() !== 'bearer') {
    return res.status(401).json({ success: false, error: 'Định dạng token không đúng. Vui lòng thử đăng nhập lại.' });
  }

  const token = tokenParts[1];

  try {
    const decoded = jwt.verify(token, getJwtSecret());
    req.user = decoded;
    next();
  } catch (error) {
    let errorMessage = 'Token không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.';
    if (error.name === 'TokenExpiredError') {
      errorMessage = 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
    }
    return res.status(401).json({ success: false, error: errorMessage });
  }
}

module.exports = authMiddleware;
