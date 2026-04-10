import { BrowserRouter, Link, Route, Routes, useNavigate, useParams, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import axios from 'axios';

const API = process.env.REACT_APP_API_URL || 'https://secret-board-2q81.onrender.com/api';
const FILE_BASE_URL = process.env.REACT_APP_FILE_BASE_URL || 'https://secret-board-2q81.onrender.com';

function getAdminToken() {
  return localStorage.getItem('adminToken') || '';
}

function apiConfig() {
  const token = getAdminToken();
  return token ? { headers: { Authorization: `Bearer ${token}` } } : {};
}

function PasswordModal({ open, title, onClose, onConfirm }) {
  const [password, setPassword] = useState('');

  useEffect(() => {
    if (open) setPassword('');
  }, [open]);

  if (!open) return null;

  return (
    <div style={modalBackdropStyle}>
      <div style={modalBoxStyle}>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#4d6254', marginBottom: 14 }}>
          {title}
        </div>

        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="비밀번호 입력"
          style={fullInputStyle}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') onConfirm(password);
          }}
        />

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
          <button onClick={onClose} style={subBtnStyle}>취소</button>
          <button onClick={() => onConfirm(password)} style={mainBtnStyle('#70866f', 92)}>확인</button>
        </div>
      </div>
    </div>
  );
}

function Layout({ children }) {
  const navigate = useNavigate();
  const isAdmin = !!getAdminToken();
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordMessage, setPasswordMessage] = useState('');

  const logout = () => {
    localStorage.removeItem('adminToken');
    alert('로그아웃 되었습니다.');
    navigate('/');
    window.location.reload();
  };

  const changePassword = async () => {
    setPasswordMessage('');
    try {
      const res = await axios.post(
        `${API}/admin/change-password`,
        { currentPassword, newPassword },
        apiConfig()
      );
      setPasswordMessage(res.data.message || '비밀번호가 변경되었습니다.');
      if (res.data.next?.ADMIN_PASSWORD) {
        alert(`backend/.env의 ADMIN_PASSWORD 값을 ${res.data.next.ADMIN_PASSWORD} 로 바꿔주세요.`);
      }
      setCurrentPassword('');
      setNewPassword('');
    } catch (err) {
      setPasswordMessage(err.response?.data?.message || '비밀번호 변경에 실패했습니다.');
    }
  };

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '28px 24px 80px', fontFamily: 'Arial, sans-serif', color: '#333', background: '#ffffff' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        {isAdmin ? (
          <>
            <span style={{ color: '#5d7a68', fontWeight: 700 }}>관리자 로그인 상태</span>
            <button onClick={() => setShowChangePassword(!showChangePassword)} style={topBtnStyle('#8ea595')}>
              비밀번호 변경
            </button>
            <button onClick={logout} style={topBtnStyle('#738477')}>
              로그아웃
            </button>
          </>
        ) : (
          <Link to="/admin" style={{ textDecoration: 'none' }}>
            <button style={topBtnStyle('#8b9d90')}>관리자</button>
          </Link>
        )}
      </div>

      {isAdmin && showChangePassword && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 18 }}>
          <div style={{ width: 420, border: '1px solid #e5ebe3', padding: 16, background: '#fbfcfa', borderRadius: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 10 }}>관리자 비밀번호 변경</div>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="현재 비밀번호"
              style={fullInputStyle}
            />
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="새 비밀번호"
              style={{ ...fullInputStyle, marginTop: 10 }}
            />
            {passwordMessage && <div style={{ fontSize: 14, color: '#924a4a', marginTop: 10 }}>{passwordMessage}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <button onClick={changePassword} style={mainBtnStyle('#7c927f', 110)}>변경하기</button>
            </div>
          </div>
        </div>
      )}

      <div style={{ textAlign: 'center', fontSize: 34, fontWeight: 700, marginBottom: 36, color: '#4d6254' }}>
        상담문의
      </div>

      {children}
    </div>
  );
}

function ListPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [posts, setPosts] = useState([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, totalPages: 1 });
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [selectedPost, setSelectedPost] = useState(null);
  const isAdmin = !!getAdminToken();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    setSearch(params.get('search') || '');
  }, [location.search]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams(location.search);
        const res = await axios.get(`${API}/posts?${params.toString()}`);
        setPosts(res.data.posts || []);
        setPagination(res.data.pagination || { total: 0, page: 1, totalPages: 1 });
      } catch (err) {
        alert(err.response?.data?.message || '목록을 불러오지 못했습니다.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [location.search]);

  const moveSearch = (targetPage = 1) => {
    const params = new URLSearchParams();
    params.set('page', String(targetPage));
    if (search.trim()) params.set('search', search.trim());
    navigate(`/?${params.toString()}`);
  };

  const goDetail = (post) => {
    if (isAdmin) {
      navigate(`/post/${post._id}`);
      return;
    }

    setSelectedPost(post);
    setPasswordModalOpen(true);
  };

  const confirmPassword = async (password) => {
    if (!selectedPost) return;
    if (!password) return;

    try {
      await axios.post(`${API}/post/${selectedPost._id}/check`, { password });
      setPasswordModalOpen(false);
      navigate(`/post/${selectedPost._id}?access=granted`);
    } catch (err) {
      alert(err.response?.data?.message || '비밀번호가 틀렸습니다.');
    }
  };

  const visiblePages = Array.from({ length: pagination.totalPages }, (_, i) => i + 1).slice(0, 10);

  return (
    <Layout>
      <PasswordModal
        open={passwordModalOpen}
        title="글 비밀번호를 입력하세요"
        onClose={() => setPasswordModalOpen(false)}
        onConfirm={confirmPassword}
      />

      <div style={panelStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18, gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 16, color: '#68766e' }}>전체 : {pagination.total.toLocaleString()}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="검색어"
              style={{ width: 320, height: 48, border: '1px solid #d9e0d8', borderRadius: 10, padding: '0 14px', fontSize: 15 }}
            />
            <button onClick={() => moveSearch(1)} style={mainBtnStyle('#7b8f7c', 120)}>검색하기</button>
          </div>
        </div>

        <div style={{ borderTop: '2px solid #cfd8cc' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr 130px 130px', padding: '16px 0', fontWeight: 700, borderBottom: '1px solid #e6ede4', textAlign: 'center', color: '#58645c' }}>
            <div>번호</div>
            <div>제목</div>
            <div>작성자</div>
            <div>등록일</div>
          </div>

          {loading ? (
            <div style={{ padding: 40, textAlign: 'center' }}>불러오는 중...</div>
          ) : (
            posts.map((post, index) => {
              const rowBg = post.isNotice ? '#fafcf8' : '#fff';

              return (
                <div
                  key={post._id}
                  onClick={() => goDetail(post)}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '90px 1fr 130px 130px',
                    padding: '18px 0',
                    borderBottom: '1px solid #eef2ec',
                    cursor: 'pointer',
                    alignItems: 'center',
                    background: rowBg,
                  }}
                >
                  <div style={{ textAlign: 'center', fontSize: 17, color: '#5f6a63' }}>
                    {post.isNotice ? '공지' : pagination.total - ((pagination.page - 1) * 10 + index)}
                  </div>

                  <div style={{ paddingRight: 20, paddingLeft: post.isReply ? 28 : 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 24 }}>
                      {post.isReply ? (
                        <span style={{ color: '#8aa08c', fontSize: 15, fontWeight: 700 }}>↳</span>
                      ) : null}

                      <span style={{ fontWeight: post.isNotice ? 700 : 500, color: '#404840' }}>
                        {post.isReply ? `[RE] ${post.title}` : post.title}
                      </span>

                      {post.hasAttachment ? <span style={{ color: '#7c8b80', fontSize: 13 }}>[첨부]</span> : null}
                      {post.isNew ? <span style={{ color: '#d45454', fontSize: 12, fontWeight: 700 }}>NEW</span> : null}
                    </div>
                  </div>

                  <div style={{ textAlign: 'center', color: '#5f6a63' }}>{post.nickname}</div>
                  <div style={{ textAlign: 'center', color: '#5f6a63' }}>{new Date(post.createdAt).toISOString().slice(0, 10)}</div>
                </div>
              );
            })
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 22 }}>
          <div style={{ flex: 1, display: 'flex', justifyContent: 'center', gap: 10, alignItems: 'center' }}>
            {visiblePages.map((n) => (
              <button
                key={n}
                onClick={() => moveSearch(n)}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  border: 'none',
                  background: n === pagination.page ? '#e8efe5' : 'transparent',
                  cursor: 'pointer',
                  fontSize: 16,
                  color: '#58645c',
                }}
              >
                {n}
              </button>
            ))}
          </div>

          <Link to="/write" style={{ textDecoration: 'none' }}>
            <button style={mainBtnStyle('#70866f', 96)}>글쓰기</button>
          </Link>
        </div>
      </div>
    </Layout>
  );
}

function WritePage() {
  const navigate = useNavigate();
  const isAdmin = !!getAdminToken();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const parentPostId = params.get('parentId') || '';

  const [message, setMessage] = useState('');
  const [form, setForm] = useState({
    title: '',
    content: '',
    nickname: '',
    password: '',
    isNotice: false,
    attachment: null,
  });

  const submit = async () => {
    setMessage('');

    try {
      const body = new FormData();

      if (!parentPostId) {
        body.append('title', form.title);
      }

      body.append('content', form.content);
      body.append('nickname', isAdmin ? '관리자' : form.nickname);
      body.append('password', form.password);
      body.append('isNotice', String(form.isNotice));

      if (parentPostId) body.append('parentPostId', parentPostId);
      if (form.attachment) body.append('attachment', form.attachment);

      const res = await axios.post(`${API}/write`, body, {
        ...apiConfig(),
        headers: {
          ...apiConfig().headers,
          'Content-Type': 'multipart/form-data',
        },
      });

      if (res.data.ok) {
        alert('등록되었습니다.');
        navigate('/');
      }
    } catch (err) {
      setMessage(err.response?.data?.message || '등록에 실패했습니다.');
    }
  };

  return (
    <Layout>
      <div style={panelStyle}>
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#4d6254', marginBottom: 6 }}>
            {parentPostId ? '답글 작성' : isAdmin ? '관리자 글쓰기' : '글쓰기'}
          </div>
          <div style={{ color: '#7b877f', fontSize: 14 }}>
            {parentPostId
              ? '답글 제목은 원글 제목과 동일하게 등록됩니다.'
              : isAdmin
              ? '관리자는 비밀번호 없이 글을 작성할 수 있습니다.'
              : '상담 내용을 편하게 남겨주세요.'}
          </div>
        </div>

        <div style={{ borderTop: '2px solid #cfd8cc', paddingTop: 18 }}>
          {!parentPostId ? (
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="제목"
              style={fullInputStyle}
            />
          ) : (
            <div style={{ ...readonlyBoxStyle, marginBottom: 12 }}>
              답글 제목은 자동으로 원글 제목이 사용됩니다.
            </div>
          )}

          <textarea
            value={form.content}
            onChange={(e) => setForm({ ...form, content: e.target.value })}
            placeholder="내용"
            rows={14}
            style={{ width: '100%', border: '1px solid #d9e0d8', borderRadius: 10, padding: 14, boxSizing: 'border-box', resize: 'vertical', fontSize: 15 }}
          />

          <div style={{ display: 'grid', gridTemplateColumns: isAdmin ? '1fr' : '1fr 1fr', gap: 12, marginTop: 12 }}>
            {!isAdmin ? (
              <>
                <input
                  value={form.nickname}
                  onChange={(e) => setForm({ ...form, nickname: e.target.value })}
                  placeholder="작성자"
                  style={fullInputStyle}
                />
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder={parentPostId ? '답글 비밀번호 (원글과 동일하게 입력)' : '비밀번호 (4자 이상)'}
                  style={fullInputStyle}
                />
              </>
            ) : (
              <div style={{ ...readonlyBoxStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <span>작성자명은 <strong>관리자</strong>로 자동 등록됩니다.</span>
                {!parentPostId ? (
                  <label style={{ color: '#5e6c62', fontWeight: 700 }}>
                    <input
                      type="checkbox"
                      checked={form.isNotice}
                      onChange={(e) => setForm({ ...form, isNotice: e.target.checked })}
                    /> 공지글
                  </label>
                ) : (
                  <span style={{ color: '#6e7d72', fontSize: 14 }}>답글 비밀번호는 원글과 자동 동일합니다.</span>
                )}
              </div>
            )}
          </div>

          <div style={{ marginTop: 14 }}>
            <label style={{ display: 'block', marginBottom: 8, color: '#5e6c62', fontWeight: 700 }}>첨부파일</label>
            <input
              type="file"
              onChange={(e) => setForm({ ...form, attachment: e.target.files?.[0] || null })}
            />
          </div>

          {message ? <div style={{ color: '#b04b4b', marginTop: 12 }}>{message}</div> : null}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
            <Link to="/" style={{ textDecoration: 'none' }}>
              <button style={subBtnStyle}>목록</button>
            </Link>
            <button onClick={submit} style={mainBtnStyle('#70866f', 92)}>등록</button>
          </div>
        </div>
      </div>
    </Layout>
  );
}

function DetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [post, setPost] = useState(null);
  const [loading, setLoading] = useState(true);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [attachmentDeleteModalOpen, setAttachmentDeleteModalOpen] = useState(false);
  const isAdmin = !!getAdminToken();

  useEffect(() => {
    const run = async () => {
      try {
        const res = await axios.get(`${API}/post/${id}`, apiConfig());
        setPost(res.data.post);
      } catch (err) {
        alert(err.response?.data?.message || '글을 불러오지 못했습니다.');
        navigate('/');
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [id, navigate]);

  const removePost = async (password = '') => {
    try {
      await axios.post(`${API}/delete`, { id, password }, apiConfig());
      alert('삭제되었습니다.');
      navigate('/');
    } catch (err) {
      alert(err.response?.data?.message || '삭제에 실패했습니다.');
    }
  };

  const removeAttachment = async (password = '') => {
    if (!post?.hasAttachment) return;

    try {
      await axios.post(`${API}/delete-attachment`, { id, password }, apiConfig());
      alert('첨부파일이 삭제되었습니다.');
      const res = await axios.get(`${API}/post/${id}`, apiConfig());
      setPost(res.data.post);
    } catch (err) {
      alert(err.response?.data?.message || '첨부파일 삭제에 실패했습니다.');
    }
  };

  if (loading) {
    return <Layout><div>불러오는 중...</div></Layout>;
  }

  if (!post) {
    return <Layout><div>글을 찾을 수 없습니다.</div></Layout>;
  }

  return (
    <Layout>
      {!isAdmin && (
        <>
          <PasswordModal
            open={deleteModalOpen}
            title="삭제 비밀번호를 입력하세요"
            onClose={() => setDeleteModalOpen(false)}
            onConfirm={(password) => {
              if (!password) return;
              setDeleteModalOpen(false);
              removePost(password);
            }}
          />
          <PasswordModal
            open={attachmentDeleteModalOpen}
            title="첨부파일 삭제 비밀번호를 입력하세요"
            onClose={() => setAttachmentDeleteModalOpen(false)}
            onConfirm={(password) => {
              if (!password) return;
              setAttachmentDeleteModalOpen(false);
              removeAttachment(password);
            }}
          />
        </>
      )}

      <div style={panelStyle}>
        <div style={{ borderTop: '2px solid #cfd8cc' }}>
          <div style={{ padding: '18px 0', borderBottom: '1px solid #e6ede4', fontSize: 28, fontWeight: 700, color: '#49564d' }}>
            {post.isReply ? `[RE] ${post.title}` : post.title}
          </div>

          <div style={{ display: 'flex', gap: 24, padding: '16px 0', borderBottom: '1px solid #e6ede4', color: '#6a766e', flexWrap: 'wrap' }}>
            <div>작성자: {post.nickname}</div>
            <div>등록일: {new Date(post.createdAt).toLocaleString()}</div>
            {post.isNotice ? <div style={{ color: '#6f8b76', fontWeight: 700 }}>공지글</div> : null}
          </div>

          {post.hasAttachment ? (
            <div style={{ padding: '16px 0', borderBottom: '1px solid #e6ede4', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 700, marginBottom: 6, color: '#5f6d63' }}>첨부파일</div>
                <a
                  href={`${FILE_BASE_URL}${post.attachment.fileUrl}`}
                  target="_blank"
                  rel="noreferrer"
                  title={post.attachment.originalName}
                  style={{
                    color: '#60786a',
                    textDecoration: 'underline',
                    display: 'inline-block',
                    maxWidth: '100%',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    verticalAlign: 'top',
                  }}
                >
                  {post.attachment.originalName}
                </a>
              </div>

              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <a href={`${API}/download/${post._id}`} style={{ textDecoration: 'none' }}>
                  <button style={mainBtnStyle('#7d8f83', 92)}>다운로드</button>
                </a>
                <button
                  onClick={() => {
                    if (isAdmin) removeAttachment('');
                    else setAttachmentDeleteModalOpen(true);
                  }}
                  style={mainBtnStyle('#9a7a7a', 110)}
                >
                  첨부삭제
                </button>
              </div>
            </div>
          ) : null}

          <div style={{ minHeight: 280, padding: '24px 0', whiteSpace: 'pre-wrap', lineHeight: 1.8, color: '#3f4741' }}>
            {post.content}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 24 }}>
            <button onClick={() => navigate('/')} style={subBtnStyle}>목록</button>
            <button onClick={() => navigate(`/write?parentId=${post._id}`)} style={mainBtnStyle('#7a8e7a', 92)}>답글</button>
            <button
              onClick={() => {
                if (isAdmin) removePost('');
                else setDeleteModalOpen(true);
              }}
              style={mainBtnStyle('#8a7474', 92)}
            >
              삭제
            </button>
          </div>
        </div>
      </div>
    </Layout>
  );
}

function AdminLoginPage() {
  const navigate = useNavigate();
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');

  const login = async () => {
    setMessage('');
    try {
      const res = await axios.post(`${API}/admin/login`, { id, password });
      localStorage.setItem('adminToken', res.data.token);
      alert(res.data.message || '관리자 로그인 되었습니다.');
      navigate('/');
      window.location.reload();
    } catch (err) {
      setMessage(err.response?.data?.message || '로그인에 실패했습니다.');
    }
  };

  return (
    <Layout>
      <div style={{ maxWidth: 480, margin: '60px auto', border: '1px solid #e1e7df', borderRadius: 14, padding: 28, background: '#fff' }}>
        <h2 style={{ marginTop: 0, color: '#526258' }}>관리자 로그인</h2>
        <input
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder="관리자 아이디"
          style={fullInputStyle}
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="관리자 비밀번호"
          style={{ ...fullInputStyle, marginTop: 12 }}
        />
        {message ? <div style={{ color: '#a34d4d', marginTop: 12 }}>{message}</div> : null}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
          <Link to="/" style={{ textDecoration: 'none' }}>
            <button style={subBtnStyle}>취소</button>
          </Link>
          <button onClick={login} style={mainBtnStyle('#738873', 92)}>로그인</button>
        </div>
      </div>
    </Layout>
  );
}

function topBtnStyle(bg) {
  return {
    minWidth: 92,
    height: 40,
    border: 'none',
    background: bg,
    color: '#fff',
    cursor: 'pointer',
    borderRadius: 10,
    padding: '0 14px',
  };
}

function mainBtnStyle(bg, width) {
  return {
    width,
    height: 44,
    border: 'none',
    background: bg,
    color: '#fff',
    cursor: 'pointer',
    borderRadius: 10,
  };
}

const subBtnStyle = {
  width: 92,
  height: 44,
  border: '1px solid #d5ddd3',
  background: '#fff',
  cursor: 'pointer',
  borderRadius: 10,
  color: '#5d6a61',
};

const fullInputStyle = {
  width: '100%',
  height: 48,
  border: '1px solid #d9e0d8',
  borderRadius: 10,
  padding: '0 14px',
  boxSizing: 'border-box',
  fontSize: 15,
};

const readonlyBoxStyle = {
  width: '100%',
  minHeight: 48,
  border: '1px solid #e1e8de',
  borderRadius: 10,
  padding: '12px 14px',
  boxSizing: 'border-box',
  background: '#fafcf9',
  color: '#66746b',
};

const panelStyle = {
  background: '#fff',
  border: '1px solid #e6ece4',
  borderRadius: 16,
  padding: 22,
  boxShadow: '0 6px 20px rgba(0,0,0,0.03)',
};

const modalBackdropStyle = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.28)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 9999,
};

const modalBoxStyle = {
  width: 380,
  background: '#fff',
  borderRadius: 14,
  padding: 22,
  boxShadow: '0 10px 30px rgba(0,0,0,0.15)',
};

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ListPage />} />
        <Route path="/write" element={<WritePage />} />
        <Route path="/post/:id" element={<DetailPage />} />
        <Route path="/admin" element={<AdminLoginPage />} />
      </Routes>
    </BrowserRouter>
  );
}