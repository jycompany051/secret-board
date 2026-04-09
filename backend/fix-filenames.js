const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.log('MONGO_URI 없음');
  process.exit(1);
}

function fixBrokenKorean(text) {
  if (!text || typeof text !== 'string') return text;

  try {
    const fixed = Buffer.from(text, 'latin1').toString('utf8');

    const brokenPattern = /[ÃÂÐËÌÍÎÏÑÒÓÔÕÖØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïð]/;
    const koreanPattern = /[가-힣]/;

    if (koreanPattern.test(fixed) || brokenPattern.test(text)) {
      return fixed;
    }

    return text;
  } catch (error) {
    return text;
  }
}

async function run() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('MongoDB 연결 성공');

    const PostSchema = new mongoose.Schema({}, { strict: false });
    const Post = mongoose.models.Post || mongoose.model('Post', PostSchema, 'posts');

    const posts = await Post.find({});
    let fixedCount = 0;

    for (const post of posts) {
      if (!post.attachment || !post.attachment.originalName) {
        continue;
      }

      const original = post.attachment.originalName;
      const fixed = fixBrokenKorean(original);

      if (original !== fixed) {
        post.attachment.originalName = fixed;
        await post.save();

        fixedCount += 1;
        console.log(`복구 완료: ${original}  ->  ${fixed}`);
      }
    }

    console.log(`총 ${fixedCount}개 수정 완료`);
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('오류 발생:', error);
    try {
      await mongoose.disconnect();
    } catch (e) {}
    process.exit(1);
  }
}

run();