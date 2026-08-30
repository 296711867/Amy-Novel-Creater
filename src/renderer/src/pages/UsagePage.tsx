import { useEffect } from "react";
import { Coins } from "lucide-react";
import { summarizeUsage } from "@domain/usage";
import { useNovelStore } from "../store/novel-store";
import "../context.css";
export function UsagePage(): React.JSX.Element {
  const records = useNovelStore((s) => s.usage),
    load = useNovelStore((s) => s.loadUsage),
    novels = useNovelStore((s) => s.novels);
  useEffect(() => {
    void load();
  }, [load]);
  const sum = summarizeUsage(records);
  return (
    <main className="page usage-page">
      <div className="eyebrow">
        <Coins size={16} /> TOKEN & COST
      </div>
      <h1>模型用量</h1>
      <p className="lead">
        供应商实测与本地预算估算分开统计。当前尚未调用模型时，真实消耗保持为 0。
      </p>
      <div className="usage-summary">
        <article>
          <span>真实输入</span>
          <b>{sum.actualInputTokens.toLocaleString()}</b>
          <small>provider tokens</small>
        </article>
        <article>
          <span>真实输出</span>
          <b>{sum.actualOutputTokens.toLocaleString()}</b>
          <small>{sum.actualRuns} 次模型调用</small>
        </article>
        <article>
          <span>缓存命中</span>
          <b>{sum.actualCachedTokens.toLocaleString()}</b>
          <small>cached tokens</small>
        </article>
        <article>
          <span>预算估算</span>
          <b>{sum.estimatedTokens.toLocaleString()}</b>
          <small>{sum.estimates} 次上下文预览</small>
        </article>
        <article>
          <span>已知费用</span>
          <b>¥ {sum.cost.toFixed(4)}</b>
          <small>未配置价格时不推测</small>
        </article>
      </div>
      <section className="usage-table">
        <header>
          <b>记录</b>
          <span>{records.length} 条</span>
        </header>
        {records.length === 0 ? (
          <div className="empty-inline">暂无用量记录</div>
        ) : (
          records.map((item) => (
            <div key={item.id}>
              <span>{new Date(item.createdAt).toLocaleString()}</span>
              <b>
                {novels.find((n) => n.id === item.novelId)?.title ?? "未知作品"}
              </b>
              <span>{item.operation}</span>
              <span>{item.measurement === "provider" ? "实测" : "估算"}</span>
              <span>
                {(item.inputTokens + item.outputTokens).toLocaleString()} tokens
              </span>
            </div>
          ))
        )}
      </section>
    </main>
  );
}
