/**
 * 應用程式進入點。
 *
 * 目前的版面為最小可跑版本，供第一階段驗證建置流程；
 * 完整介面（暗色夜店酒吧風格、動態互動）於介面階段接續實作。
 */
export default function App() {
  return (
    <main className="min-h-screen bg-night-900 px-6 py-16 text-ink">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-4xl font-bold tracking-tight">
          join <span className="text-neon-purple">這麼喝</span>
        </h1>
        <p className="mt-4 text-lg text-ink-muted">
          勾選你手邊已有的材料，即時算出只差最少材料的調酒推薦。
        </p>
      </div>
    </main>
  );
}
