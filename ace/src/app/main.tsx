import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import "./ui.css";

// 根级错误边界：任何渲染崩溃显示错误卡而非白屏（v0.9 检错：App 内边界为死导入从未生效）
createRoot(document.getElementById("root")!).render(
  <ErrorBoundary label="应用">
    <App />
  </ErrorBoundary>,
);
