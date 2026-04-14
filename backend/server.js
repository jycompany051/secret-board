const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const dotenv = require('dotenv');
const { v2: cloudinary } = require('cloudinary');

dotenv.config();

const app = express();

// =========================
// 기본 설정
// =========================
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET || 'secret-board-jwt-key';
const ADMIN_ID = process.env.ADMIN_ID || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '1234';
const PAGE_SIZE = 10;

const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
  'https://secret-board-e88q.vercel.app',
  'https://secret-board-e88q-git-main-jycompany051s-projects.vercel.app',
  'https://secret-board-e88q-9qhnhxuzp-jycompany051s-projects.vercel.app',
  'https://sites.google.com',
  process.env.FRONTEND_URL,
].filter(Boolean);

if (!MONGO_URI) {
  console.error('MONGO_URI가 .env에 없습니다.');
  process.exit(1);
}

if (
  !process.env.CLOUDINARY_CLOUD_NAME ||
  !process.env.CLOUDINARY_API_KEY ||
  !process.env.CLOUDINARY_API_SECRET
) {
  console.error('Cloudinary 환경변수가 .env에 없습니다.');
  process.exit(1);
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
  })
);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

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
// 헬스체크
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
    publicId: { type: String, default: '' },
    resourceType: { type: String, default: 'auto' },
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

    isNotice: { type: Boolean, default: false, index: true },
    isReply: { type: Boolean, default: false, index: true },
    parentPostId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', default: null, index: true },

    isCheckedByAdmin: { type: Boolean, default: false },
    attachments: { type: [attachmentSchema], default: [] },
  },
  { timestamps: true }
);

postSchema.index({ createdAt: -1 });
postSchema.index({ title: 'text', nickname: 'text' });

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
      await Admin.create({
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
  } catch {
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
  } catch {
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
  } catch {
    return name;
  }
}

function buildContentDisposition(filename) {
  const safeAscii = String(filename || 'download')
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/"/g, '');

  const encoded = encodeURIComponent(filename || 'download');
  return `attachment; filename="${safeAscii}"; filename*=UTF-8''${encoded}`;
}

// =========================
// multer 설정
// =========================
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 5,
  },
});

// =========================
// Cloudinary 유틸
// =========================
function hasAttachments(attachments) {
  return Array.isArray(attachments) && attachments.length > 0;
}

function uploadOneToCloudinary(file, folder = 'secret-board') {
  return new Promise((resolve, reject) => {
    const decodedName = decodeOriginalName(file.originalname || '');
    const publicBase = decodedName.replace(/\.[^/.]+$/, '');

    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: 'auto',
        public_id: publicBase,
        use_filename: true,
        unique_filename: true,
      },
      (error, result) => {
        if (error) return reject(error);
        return resolve(result);
      }
    );

    stream.end(file.buffer);
  });
}

async function uploadFilesToCloudinary(files) {
  if (!Array.isArray(files) || files.length === 0) return [];

  const uploaded = [];
  for (const file of files) {
    const decodedName = decodeOriginalName(file.originalname || '');
    const result = await uploadOneToCloudinary({
      ...file,
      originalname: decodedName,
    });

    uploaded.push({
      originalName: decodedName,
      fileName: result.original_filename || decodedName || '',
      fileUrl: result.secure_url || '',
      publicId: result.public_id || '',
      resourceType: result.resource_type || 'auto',
      size: file.size || 0,
      mimetype: file.mimetype || '',
    });
  }

  return uploaded;
}

async function destroyCloudinaryAsset(attachment) {
  if (!attachment?.publicId) return;

  await cloudinary.uploader.destroy(attachment.publicId, {
    resource_type: attachment.resourceType || 'image',
  });
}

// =========================
// 목록 정렬/구성 유틸
// =========================
function buildSearchQuery(search) {
  const keyword = String(search || '').trim();
  if (!keyword) return {};

  return {
    $or: [
      { title: { $regex: keyword, $options: 'i' } },
      { nickname: { $regex: keyword, $options: 'i' } },
    ],
  };
}

function toListItem(post) {
  return {
    ...post,
    hasAttachment: hasAttachments(post.attachments),
    attachmentCount: Array.isArray(post.attachments) ? post.attachments.length : 0,
    isNew: !post.isCheckedByAdmin && !post.isReply && !post.isNotice,
  };
}

// =========================
// 게시글 목록
// =========================
app.get('/api/posts', async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const search = String(req.query.search || '').trim();
    const query = buildSearchQuery(search);

    const total = await Post.countDocuments(query);

    const noticePosts = await Post.find({
      ...query,
      isNotice: true,
    })
      .sort({ createdAt: -1 })
      .lean();

    const normalParentPosts = await Post.find({
      ...query,
      isNotice: false,
      isReply: false,
    })
      .sort({ createdAt: -1 })
      .lean();

    const parentIds = normalParentPosts.map((post) => post._id);

    const replyPosts = parentIds.length
      ? await Post.find({
          isReply: true,
          parentPostId: { $in: parentIds },
        })
          .sort({ createdAt: 1 })
          .lean()
      : [];

    const replyMap = {};
    for (const reply of replyPosts) {
      const key = String(reply.parentPostId || '');
      if (!replyMap[key]) replyMap[key] = [];
      replyMap[key].push(reply);
    }

    const arrangedPosts = [];
    let normalNumber = total;

    for (const notice of noticePosts) {
      arrangedPosts.push({
        ...toListItem(notice),
        displayNumber: '<공지>',
      });
    }

    for (const parent of normalParentPosts) {
      arrangedPosts.push({
        ...toListItem(parent),
        displayNumber: normalNumber,
      });

      normalNumber -= 1;

      const children = replyMap[String(parent._id)] || [];
      for (const child of children) {
        arrangedPosts.push({
          ...toListItem(child),
          displayNumber: '',
        });
      }
    }

    const totalPages = Math.max(Math.ceil(arrangedPosts.length / PAGE_SIZE), 1);
    const start = (page - 1) * PAGE_SIZE;
    const pagePosts = arrangedPosts.slice(start, start + PAGE_SIZE);

    return res.json({
      posts: pagePosts,
      pagination: {
        total,
        page,
        totalPages,
        pageSize: PAGE_SIZE,
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
        hasAttachment: hasAttachments(post.attachments),
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
app.post('/api/write', upload.array('attachments', 5), async (req, res) => {
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

    const uploadedAttachments = await uploadFilesToCloudinary(req.files);

    const created = await Post.create({
      title,
      content,
      nickname: finalNickname,
      password: hashedPassword,
      isNotice: finalIsNotice,
      isReply: finalIsReply,
      parentPostId: finalParentPostId,
      isCheckedByAdmin: finalIsCheckedByAdmin,
      attachments: uploadedAttachments,
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

    if (hasAttachments(post.attachments)) {
      for (const attachment of post.attachments) {
        await destroyCloudinaryAsset(attachment);
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
// 첨부파일 전체 삭제
// =========================
app.post('/api/delete-attachment', async (req, res) => {
  try {
    const { id, password } = req.body;
    const isAdmin = getIsAdminFromRequest(req);

    const post = await Post.findById(id);
    if (!post) {
      return res.status(404).json({ message: '글을 찾을 수 없습니다.' });
    }

    if (!hasAttachments(post.attachments)) {
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

    for (const attachment of post.attachments) {
      await destroyCloudinaryAsset(attachment);
    }

    post.attachments = [];
    await post.save();

    return res.json({ ok: true, message: '첨부파일이 삭제되었습니다.' });
  } catch (error) {
    console.error('POST /api/delete-attachment error:', error);
    return res.status(500).json({ message: '첨부파일 삭제에 실패했습니다.' });
  }
});

// =========================
// 첨부파일 개별 삭제
// =========================
app.post('/api/delete-attachment-one', async (req, res) => {
  try {
    const { id, index, password } = req.body;
    const isAdmin = getIsAdminFromRequest(req);

    const post = await Post.findById(id);
    if (!post) {
      return res.status(404).json({ message: '글을 찾을 수 없습니다.' });
    }

    if (!hasAttachments(post.attachments)) {
      return res.status(400).json({ message: '삭제할 첨부파일이 없습니다.' });
    }

    const attachmentIndex = Number(index);
    if (
      Number.isNaN(attachmentIndex) ||
      attachmentIndex < 0 ||
      attachmentIndex >= post.attachments.length
    ) {
      return res.status(400).json({ message: '첨부파일 번호가 올바르지 않습니다.' });
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

    const target = post.attachments[attachmentIndex];
    await destroyCloudinaryAsset(target);

    post.attachments.splice(attachmentIndex, 1);
    await post.save();

    return res.json({ ok: true, message: '첨부파일이 삭제되었습니다.' });
  } catch (error) {
    console.error('POST /api/delete-attachment-one error:', error);
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

    if (!post || !hasAttachments(post.attachments)) {
      return res.status(404).json({ message: '첨부파일이 없습니다.' });
    }

    const file = post.attachments[0];
    if (!file?.fileUrl) {
      return res.status(404).json({ message: '파일을 찾을 수 없습니다.' });
    }

    const response = await fetch(file.fileUrl);
    if (!response.ok) {
      return res.status(404).json({ message: '파일을 가져오지 못했습니다.' });
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    res.setHeader(
      'Content-Type',
      file.mimetype || response.headers.get('content-type') || 'application/octet-stream'
    );
    res.setHeader('Content-Length', buffer.length);
    res.setHeader(
      'Content-Disposition',
      buildContentDisposition(file.originalName || 'download')
    );

    return res.send(buffer);
  } catch (error) {
    console.error('GET /api/download/:id error:', error);
    return res.status(500).json({ message: '파일 다운로드에 실패했습니다.' });
  }
});

app.get('/api/download/:id/:index', async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);

    if (!post || !hasAttachments(post.attachments)) {
      return res.status(404).json({ message: '첨부파일이 없습니다.' });
    }

    const index = Number(req.params.index);
    const file = post.attachments[index];

    if (!file?.fileUrl) {
      return res.status(404).json({ message: '파일을 찾을 수 없습니다.' });
    }

    const response = await fetch(file.fileUrl);
    if (!response.ok) {
      return res.status(404).json({ message: '파일을 가져오지 못했습니다.' });
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    res.setHeader(
      'Content-Type',
      file.mimetype || response.headers.get('content-type') || 'application/octet-stream'
    );
    res.setHeader('Content-Length', buffer.length);
    res.setHeader(
      'Content-Disposition',
      buildContentDisposition(file.originalName || 'download')
    );

    return res.send(buffer);
  } catch (error) {
    console.error('GET /api/download/:id/:index error:', error);
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