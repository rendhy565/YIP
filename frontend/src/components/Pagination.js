import React, { useEffect, useMemo, useState } from "react";

/**
 * Hook: usePagination
 * Takes the full array of items + an identity key for resets (e.g. filter signature)
 * Returns { paged, page, setPage, pageSize, setPageSize, total, totalPages, controls }
 */
export function usePagination(items = [], { defaultSize = 25, resetKey = "" } = {}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultSize);

  // Reset to page 1 when filter signature changes
  useEffect(() => { setPage(1); }, [resetKey]);

  const total = items.length;
  const isAll = pageSize === "all";
  const sizeNum = isAll ? total : pageSize;
  const totalPages = isAll ? 1 : Math.max(1, Math.ceil(total / (sizeNum || 1)));
  const paged = useMemo(() => {
    if (isAll) return items;
    const start = (page - 1) * sizeNum;
    return items.slice(start, start + sizeNum);
  }, [items, page, sizeNum, isAll]);

  return { paged, page, setPage, pageSize, setPageSize, total, totalPages, isAll };
}

/**
 * Pagination control component
 */
export default function Pagination({ page, setPage, pageSize, setPageSize, total, totalPages, isAll, testid = "pagination" }) {
  const [pendingAll, setPendingAll] = useState(false);

  const onChangeSize = (v) => {
    if (v === "all") { setPendingAll(true); return; }
    setPageSize(parseInt(v, 10));
    setPage(1);
  };
  const confirmAll = () => { setPageSize("all"); setPage(1); setPendingAll(false); };

  if (total === 0) return null;

  const from = isAll ? 1 : (page - 1) * pageSize + 1;
  const to = isAll ? total : Math.min(page * pageSize, total);

  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-slate-200 text-xs" data-testid={testid}>
      <div className="text-slate-500">Menampilkan <span className="font-semibold">{from}–{to}</span> dari <span className="font-semibold">{total}</span> baris</div>
      <div className="flex items-center gap-2">
        <span className="text-slate-500">Tampilkan:</span>
        <select
          data-testid={`${testid}-size`}
          value={isAll ? "all" : String(pageSize)}
          onChange={(e) => onChangeSize(e.target.value)}
          className="h-7 rounded border border-slate-300 px-2 text-xs bg-white"
        >
          <option value="25">25</option>
          <option value="50">50</option>
          <option value="100">100</option>
          <option value="all">Semua</option>
        </select>
        {!isAll && (
          <div className="flex items-center gap-1 ml-2">
            <button data-testid={`${testid}-first`} onClick={() => setPage(1)} disabled={page === 1} className="px-2 py-1 rounded border border-slate-300 disabled:opacity-30 hover:bg-slate-50">«</button>
            <button data-testid={`${testid}-prev`} onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="px-2 py-1 rounded border border-slate-300 disabled:opacity-30 hover:bg-slate-50">‹</button>
            <span className="px-2">{page} / {totalPages}</span>
            <button data-testid={`${testid}-next`} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-2 py-1 rounded border border-slate-300 disabled:opacity-30 hover:bg-slate-50">›</button>
            <button data-testid={`${testid}-last`} onClick={() => setPage(totalPages)} disabled={page === totalPages} className="px-2 py-1 rounded border border-slate-300 disabled:opacity-30 hover:bg-slate-50">»</button>
          </div>
        )}
      </div>

      {pendingAll && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded shadow-xl p-5 max-w-sm w-full" data-testid={`${testid}-all-warning`}>
            <h4 className="font-bold text-base mb-2">⚠️ Tampilkan Semua?</h4>
            <p className="text-xs text-slate-600 mb-4">
              Anda akan menampilkan <b>{total} baris</b> sekaligus. Untuk data besar, ini bisa membuat halaman lambat & beresiko hang.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setPendingAll(false)} className="px-3 py-1.5 text-xs font-bold rounded border border-slate-300 hover:bg-slate-50">Batal</button>
              <button data-testid={`${testid}-all-confirm`} onClick={confirmAll} className="px-3 py-1.5 text-xs font-bold rounded bg-amber-600 text-white hover:bg-amber-700">Ya, tampilkan semua</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
