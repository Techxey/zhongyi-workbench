"use client";

import { useEffect } from "react";

export default function PatientsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="px-[26px] py-10">
      <div className="card px-6 py-14 text-center max-w-[560px]">
        <p className="font-serif text-[16px] text-ink mb-1.5">患者列表没有读出来</p>
        <p className="text-[13px] text-ink-3 mb-5 leading-relaxed">
          可能是本地数据库暂时不可用。先重试一次；如果反复出现，检查 prisma/dev.db 是否被其他程序占用。
        </p>
        {error.digest ? (
          <p className="text-[11.5px] text-ink-4 num mb-4">错误编号 {error.digest}</p>
        ) : null}
        <button type="button" className="btn btn-primary" onClick={reset}>
          重试
        </button>
      </div>
    </div>
  );
}
