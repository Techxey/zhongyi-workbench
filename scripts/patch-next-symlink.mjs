import fs from "node:fs";
import path from "node:path";

// Next 的 standalone 追踪步骤会用 fs.symlink 重建 pnpm 的符号链接。
// 在没开「开发者模式」的 Windows 上没有 symlink 权限会报 EPERM，导致 next build 失败。
// 这里把它改成：建不了链接就解引用复制（打包脚本后面还会再把依赖平铺一次）。
const candidates = [
  "node_modules/next/dist/build/utils.js",
  "node_modules/.pnpm/next@15.5.28_@types+node@22_9acf123f072d4d9044699b301fe1e727/node_modules/next/dist/build/utils.js",
];

const oldBlock = `                if (symlink) {
                    try {
                        await _fs.promises.symlink(symlink, fileOutputPath);
                    } catch (e) {
                        if (e.code !== 'EEXIST') {
                            throw e;
                        }
                    }
                } else {`;

const newBlock = `                if (symlink) {
                    try {
                        await _fs.promises.symlink(symlink, fileOutputPath);
                    } catch (e) {
                        if (e.code === 'EEXIST') {
                            // 已存在，跳过
                        } else {
                            // EPERM（Windows 无 symlink 权限）：解引用复制一份
                            const realTarget = _path.default.resolve(_path.default.dirname(tracedFilePath), symlink);
                            await _fs.promises.cp(realTarget, fileOutputPath, { recursive: true, dereference: true });
                        }
                    }
                } else {`;

let patched = 0;
for (const file of candidates) {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) continue;
  let source = fs.readFileSync(abs, "utf8");
  if (source.includes("EPERM（Windows 无 symlink 权限）")) {
    console.log("already patched:", file);
    continue;
  }
  if (!source.includes(oldBlock)) {
    console.log("pattern not found:", file);
    continue;
  }
  source = source.replace(oldBlock, newBlock);
  fs.writeFileSync(abs, source, "utf8");
  patched += 1;
  console.log("patched:", file);
}
console.log("patched files:", patched);
