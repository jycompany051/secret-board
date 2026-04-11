const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

dotenv.config();

const app = express();

// =========================
// 기본 설정
// =========================
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
  'https://secret-board-e88q-9qhnhxuzp-jycompany051s-projects.vercel.app',
  'https://secret-board-e88q.vercel.app',
  'https://secret-board-e88q-git-main-jycompany051s-projects.vercel.app',
  'https://sites.google.com',
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET || 'secret-board-jwt-key';
const ADMIN_ID = process.env.ADMIN_ID || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '1234';

if (!MONGO_URI) {
  console.error('MONGO_URI가 .env에 없습니다.');
  process.exit(1);
}

// =========================
// 업로드 폴더 준비
// =========================
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

app.use('/uploads', express.static(uploadsDir));

// =========================
// MongoDB 연결
// =========================
mongoose
  .connect(MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch((err) => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

// =========================
// 루트 / 헬스체크
// =========================
app.get('/', (req, res) => {
  res.status(200).send('secret-board backend is running');
});

app.get('/health', (req, res) => {
  res.status(200).json({ ok: true, message: 'server is healthy' });
});

// =========================
// 스키마
// =========================
const attachmentSchema = new mongoose.Schema(
  {
    originalName: { type: String, default: '' },
    fileName: { type: String, default: '' },
    fileUrl: { type: String, default: '' },
    size: { type: Number, default: 0 },
    mimetype: { type: String, default: '' },
  },
  { _id: false }
);

const postSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, default: '' },
    content: { type: String, required: true, default: '' },
    nickname: { type: String, required: true, default: '' },
    password: { type: String, default: '' },

    isNotice: { type: Boolean, default: false },
    isReply: { type: Boolean, default: false },
    parentPostId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', default: null },

    isCheckedByAdmin: { type: Boolean, default: false },

    attachment: { type: attachmentSchema, default: () => ({}) },
  },
  { timestamps: true }
);

const adminSchema = new mongoose.Schema(
  {
    adminId: { type: String, required: true, unique: true, default: 'admin' },
    password: { type: String, required: true, default: '' },
  },
  { timestamps: true }
);

const Post = mongoose.models.Post || mongoose.model('Post', postSchema);
const Admin = mongoose.models.Admin || mongoose.model('Admin', adminSchema);

// =========================
// 관리자 초기 생성
// =========================
async function ensureAdminAccount() {
  try {
    let admin = await Admin.findOne({ adminId: ADMIN_ID });

    if (!admin) {
      const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 10);
      admin = await Admin.create({
        adminId: ADMIN_ID,
        password: hashedPassword,
      });
      console.log(`관리자 계정 생성 완료: ${ADMIN_ID}`);
    }
  } catch (error) {
    console.error('관리자 계정 생성 오류:', error);
  }
}

// =========================
// 관리자 인증
// =========================
function signAdminToken(adminId) {
  return jwt.sign({ id: adminId, role: 'admin' }, JWT_SECRET, { expiresIn: '12h' });
}

function getIsAdminFromRequest(req) {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) return false;

    const decoded = jwt.verify(token, JWT_SECRET);
    return decoded.role === 'admin';
  } catch (error) {
    return false;
  }
}

function verifyAdmin(req, res, next) {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';

    if (!token) {
      return res.status(401).json({ message: '관리자 인증이 필요합니다.' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') {
      return res.status(403).json({ message: '권한이 없습니다.' });
    }

    req.admin = decoded;
    return next();
  } catch (error) {
    return res.status(401).json({ message: '관리자 인증이 유효하지 않습니다.' });
  }
}

// =========================
// 파일명 처리
// =========================
function decodeOriginalName(name) {
  if (!name) return '';
  try {
    return Buffer.from(name, 'latin1').toString('utf8');
  } catch (error) {
    return name;
  }
}

function sanitizeBaseName(name) {
  return (
    String(name || '')
      .normalize('NFKD')
      .replace(/[^\w\s.-]/g, '')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .trim() || 'file'
  );
}

// =========================
// multer 설정
// =========================
const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, uploadsDir);
  },
  filename(req, file, cb) {
    const decodedOriginalName = decodeOriginalName(file.originalname || '');
    const ext = path.extname(decodedOriginalName);
    const base = path.basename(decodedOriginalName || 'file', ext);
    const safeBase = sanitizeBaseName(base);
    const uniqueName = `${Date.now()}_${safeBase}${ext.toLowerCase()}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
});

function buildAttachment(file) {
  if (!file) {
    return {
      originalName: '',
      fileName: '',
      fileUrl: '',
      size: 0,
      mimetype: '',
    };
  }

  const decodedOriginalName = decodeOriginalName(file.originalname || '');

  return {
    originalName: decodedOriginalName,
    fileName: file.filename || '',
    fileUrl: `/uploads/${file.filename}`,
    size: file.size || 0,
    mimetype: file.mimetype || '',
  };
}

function hasAttachment(attachment) {
  return !!(attachment && attachment.fileName && attachment.fileUrl);
}

// =========================
// 게시글 목록
// =========================
app.get('/api/posts', async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const search = String(req.query.search || '').trim();

    const query = {};
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { nickname: { $regex: search, $options: 'i' } },
      ];
    }

    const total = await Post.countDocuments(query);

    const allPosts = await Post.find(query)
      .sort({ isNotice: -1, createdAt: -1 })
      .lean();

    const noticePosts = allPosts.filter((post) => post.isNotice);
    const normalPosts = allPosts.filter((post) => !post.isNotice);

    const parentPosts = normalPosts.filter((post) => !post.isReply);
    const replyPosts = normalPosts.filter((post) => post.isReply);

    const replyMap = {};
    for (const reply of replyPosts) {
      const key = String(reply.parentPostId || '');
      if (!replyMap[key]) replyMap[key] = [];
      replyMap[key].push(reply);
    }

    for (const key of Object.keys(replyMap)) {
      replyMap[key].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    }

    const arrangedPosts = [];
    for (const notice of noticePosts) {
      arrangedPosts.push(notice);
    }

    for (const parent of parentPosts) {
      arrangedPosts.push(parent);
      const children = replyMap[String(parent._id)] || [];
      for (const child of children) {
        arrangedPosts.push(child);
      }
    }

    const totalPages = Math.max(Math.ceil(arrangedPosts.length / 10), 1);
    const start = (page - 1) * 10;
    const end = start + 10;

    const pagePosts = arrangedPosts.slice(start, end).map((post) => ({
      ...post,
      hasAttachment: hasAttachment(post.attachment),
      isNew: !post.isCheckedByAdmin && !post.isReply && !post.isNotice,
    }));

    return res.json({
      posts: pagePosts,
      pagination: {
        total,
        page,
        totalPages,
      },
    });
  } catch (error) {
    console.error('GET /api/posts error:', error);
    return res.status(500).json({ message: '목록을 불러오지 못했습니다.' });
  }
});

// =========================
// 게시글 상세
// =========================
app.get('/api/post/:id', async (req, res) => {
  try {
    const isAdmin = getIsAdminFromRequest(req);

    const post = await Post.findById(req.params.id).lean();
    if (!post) {
      return res.status(404).json({ message: '글을 찾을 수 없습니다.' });
    }

    let parentTitle = '';
    if (post.parentPostId) {
      const parent = await Post.findById(post.parentPostId).select('title').lean();
      parentTitle = parent?.title || '';
    }

    if (isAdmin && !post.isCheckedByAdmin && !post.isNotice) {
      await Post.updateOne({ _id: post._id }, { $set: { isCheckedByAdmin: true } });
      post.isCheckedByAdmin = true;
    }

    return res.json({
      post: {
        ...post,
        parentTitle,
        hasAttachment: hasAttachment(post.attachment),
      },
    });
  } catch (error) {
    console.error('GET /api/post/:id error:', error);
    return res.status(500).json({ message: '글을 불러오지 못했습니다.' });
  }
});

// =========================
// 비밀번호 확인
// =========================
app.post('/api/post/:id/check', async (req, res) => {
  try {
    const { password } = req.body;
    const post = await Post.findById(req.params.id);

    if (!post) {
      return res.status(404).json({ message: '글을 찾을 수 없습니다.' });
    }

    if (!post.password) {
      return res.json({ ok: true });
    }

    const ok = await bcrypt.compare(password || '', post.password);
    if (!ok) {
      return res.status(403).json({ message: '비밀번호가 틀렸습니다.' });
    }

    return res.json({ ok: true });
  } catch (error) {
    console.error('POST /api/post/:id/check error:', error);
    return res.status(500).json({ message: '비밀번호 확인에 실패했습니다.' });
  }
});

// =========================
// 글 작성
// =========================
app.post('/api/write', upload.single('attachment'), async (req, res) => {
  try {
    const isAdmin = getIsAdminFromRequest(req);

    let title = String(req.body.title || '').trim();
    const content = String(req.body.content || '').trim();
    const nickname = String(req.body.nickname || '').trim();
    const password = String(req.body.password || '').trim();
    const isNotice = String(req.body.isNotice || '') === 'true';
    const parentPostId = String(req.body.parentPostId || '').trim();

    let finalNickname = isAdmin ? '관리자' : nickname;
    let finalPassword = password;
    let finalIsNotice = false;
    let finalIsReply = false;
    let finalParentPostId = null;
    let finalIsCheckedByAdmin = isAdmin;

    if (!content) {
      return res.status(400).json({ message: '내용을 입력해주세요.' });
    }

    if (!isAdmin && !finalNickname) {
      return res.status(400).json({ message: '작성자명을 입력해주세요.' });
    }

    if (parentPostId) {
      const parent = await Post.findById(parentPostId);
      if (!parent) {
        return res.status(404).json({ message: '원글을 찾을 수 없습니다.' });
      }

      finalIsReply = true;
      finalParentPostId = parent._id;
      title = parent.title;

      if (isAdmin) {
        finalNickname = '관리자';
        finalPassword = parent.password || '';
        finalIsCheckedByAdmin = true;
      } else {
        if (!finalPassword || finalPassword.length < 4) {
          return res.status(400).json({ message: '비밀번호는 4자 이상 입력해주세요.' });
        }
      }
    } else {
      if (!title) {
        return res.status(400).json({ message: '제목을 입력해주세요.' });
      }

      if (isAdmin && isNotice) {
        finalNickname = '관리자';
        finalIsNotice = true;
        finalPassword = '';
        finalIsCheckedByAdmin = true;
      } else if (isAdmin) {
        finalNickname = '관리자';
        finalPassword = '';
        finalIsCheckedByAdmin = true;
      } else {
        if (!finalPassword || finalPassword.length < 4) {
          return res.status(400).json({ message: '비밀번호는 4자 이상 입력해주세요.' });
        }
      }
    }

    let hashedPassword = '';
    if (finalPassword) {
      if (isAdmin && parentPostId) {
        hashedPassword = finalPassword;
      } else {
        hashedPassword = await bcrypt.hash(finalPassword, 10);
      }
    }

    const created = await Post.create({
      title,
      content,
      nickname: finalNickname,
      password: hashedPassword,
      isNotice: finalIsNotice,
      isReply: finalIsReply,
      parentPostId: finalParentPostId,
      isCheckedByAdmin: finalIsCheckedByAdmin,
      attachment: buildAttachment(req.file),
    });

    return res.json({ ok: true, postId: created._id });
  } catch (error) {
    console.error('POST /api/write error:', error);
    return res.status(500).json({ message: '글 등록에 실패했습니다.' });
  }
});

// =========================
// 글 삭제
// =========================
app.post('/api/delete', async (req, res) => {
  try {
    const { id, password } = req.body;
    const isAdmin = getIsAdminFromRequest(req);

    const post = await Post.findById(id);
    if (!post) {
      return res.status(404).json({ message: '글을 찾을 수 없습니다.' });
    }

    if (!isAdmin) {
      if (!post.password) {
        return res.status(403).json({ message: '삭제 권한이 없습니다.' });
      }

      const ok = await bcrypt.compare(String(password || ''), post.password);
      if (!ok) {
        return res.status(403).json({ message: '비밀번호가 틀렸습니다.' });
      }
    }

    if (hasAttachment(post.attachment)) {
      const filePath = path.join(uploadsDir, post.attachment.fileName);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    await Post.deleteOne({ _id: id });
    return res.json({ ok: true });
  } catch (error) {
    console.error('POST /api/delete error:', error);
    return res.status(500).json({ message: '삭제에 실패했습니다.' });
  }
});

// =========================
// 첨부파일 삭제
// =========================
app.post('/api/delete-attachment', async (req, res) => {
  try {
    const { id, password } = req.body;
    const isAdmin = getIsAdminFromRequest(req);

    const post = await Post.findById(id);
    if (!post) {
      return res.status(404).json({ message: '글을 찾을 수 없습니다.' });
    }

    if (!hasAttachment(post.attachment)) {
      return res.status(400).json({ message: '삭제할 첨부파일이 없습니다.' });
    }

    if (!isAdmin) {
      if (!post.password) {
        return res.status(403).json({ message: '권한이 없습니다.' });
      }

      const ok = await bcrypt.compare(String(password || ''), post.password);
      if (!ok) {
        return res.status(403).json({ message: '비밀번호가 틀렸습니다.' });
      }
    }

    const filePath = path.join(uploadsDir, post.attachment.fileName);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    post.attachment = {
      originalName: '',
      fileName: '',
      fileUrl: '',
      size: 0,
      mimetype: '',
    };

    await post.save();

    return res.json({ ok: true, message: '첨부파일이 삭제되었습니다.' });
  } catch (error) {
    console.error('POST /api/delete-attachment error:', error);
    return res.status(500).json({ message: '첨부파일 삭제에 실패했습니다.' });
  }
});

// =========================
// 관리자 로그인
// =========================
app.post('/api/admin/login', async (req, res) => {
  try {
    const { id, password } = req.body;

    const admin = await Admin.findOne({ adminId: id });
    if (!admin) {
      return res.status(401).json({ message: '관리자 아이디 또는 비밀번호가 틀렸습니다.' });
    }

    const ok = await bcrypt.compare(String(password || ''), admin.password);
    if (!ok) {
      return res.status(401).json({ message: '관리자 아이디 또는 비밀번호가 틀렸습니다.' });
    }

    const token = signAdminToken(admin.adminId);
    return res.json({
      ok: true,
      token,
      message: '관리자 로그인 되었습니다.',
    });
  } catch (error) {
    console.error('POST /api/admin/login error:', error);
    return res.status(500).json({ message: '로그인에 실패했습니다.' });
  }
});

// =========================
// 관리자 비밀번호 변경
// =========================
app.post('/api/admin/change-password', verifyAdmin, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: '현재 비밀번호와 새 비밀번호를 입력해주세요.' });
    }

    if (String(newPassword).trim().length < 4) {
      return res.status(400).json({ message: '새 비밀번호는 4자 이상 입력해주세요.' });
    }

    const admin = await Admin.findOne({ adminId: req.admin.id });
    if (!admin) {
      return res.status(404).json({ message: '관리자 계정을 찾을 수 없습니다.' });
    }

    const ok = await bcrypt.compare(String(currentPassword || ''), admin.password);
    if (!ok) {
      return res.status(400).json({ message: '현재 비밀번호가 틀렸습니다.' });
    }

    const hashedNewPassword = await bcrypt.hash(String(newPassword), 10);
    admin.password = hashedNewPassword;
    await admin.save();

    return res.json({
      ok: true,
      message: '비밀번호가 변경되었습니다.',
    });
  } catch (error) {
    console.error('POST /api/admin/change-password error:', error);
    return res.status(500).json({ message: '비밀번호 변경에 실패했습니다.' });
  }
});

// =========================
// 파일 다운로드
// =========================
app.get('/api/download/:id', async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);

    if (!post || !hasAttachment(post.attachment)) {
      return res.status(404).json({ message: '첨부파일이 없습니다.' });
    }

    const filePath = path.join(uploadsDir, post.attachment.fileName);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: '파일을 찾을 수 없습니다.' });
    }

    return res.download(filePath, post.attachment.originalName || post.attachment.fileName);
  } catch (error) {
    console.error('GET /api/download/:id error:', error);
    return res.status(500).json({ message: '파일 다운로드에 실패했습니다.' });
  }
});

// =========================
// 404 처리
// =========================
app.use((req, res) => {
  return res.status(404).json({ message: 'Not Found' });
});

// =========================
// 서버 실행
// =========================
app.listen(PORT, async () => {
  console.log(`서버 실행됨 ${PORT}포트`);
  await ensureAdminAccount();
});