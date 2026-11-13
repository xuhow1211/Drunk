/**
 * 應用程式掛載進入點。
 *
 * 掛載前先啟動資料載入（Supabase 或靜態 JSON，見 dataStore），
 * 讓載入流程與模組初始化並行，首次渲染即可顯示載入狀態。
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { startDataLoad } from './lib/dataStore';
import { startAuthLoad } from './lib/authStore';
import { startPantrySync } from './lib/pantrySync';
import './index.css';

startDataLoad();
startAuthLoad();
startPantrySync();

const container = document.getElementById('root');

if (!container) {
  throw new Error('找不到掛載節點 #root');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
