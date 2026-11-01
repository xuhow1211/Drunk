/**
 * 開啟配方詳情抽屜的共用 hook。
 *
 * 配方詳情以抽屜呈現並同步網址（/recipe/:id），
 * 因此可以分享連結，也能用瀏覽器上一頁／下一頁操作。
 *
 * 抽屜以 React Router 的「背景路由」模式實作：
 * 開啟時把目前頁面的 Location 一起存進路由 state，
 * 讓抽屜開啟時原本的頁面不會被卸載，仍留在抽屜底下。
 */
import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { Location } from 'react-router-dom';
import type { Recipe } from '../lib/types';

/**
 * 取不到背景頁面時的保底位置（首頁）。
 *
 * 由深層連結（例如直接輸入 /recipe/negroni）開啟抽屜時，路由 state 沒有背景頁面；
 * 若把配方頁本身當成背景，之後從相關推薦切換配方就再也離不開該頁。
 * 因此以首頁作為保底，關閉抽屜後一定會回到可瀏覽的頁面。
 */
export const HOME_LOCATION: Location = {
  pathname: '/',
  search: '',
  hash: '',
  state: null,
  key: 'home',
};

/**
 * 回傳開啟配方抽屜的函式。
 *
 * 若目前已經在抽屜中（由相關推薦切換配方），
 * 會沿用原本的背景頁面，避免回到抽屜開啟前的頁面時抽屜消失。
 */
export function useRecipeNav() {
  const navigate = useNavigate();
  const location = useLocation();

  return useCallback(
    (recipe: Recipe) => {
      const state = location.state as { background?: Location | null } | null;
      const explicit = state?.background;
      // 由深層連結開啟抽屜時沒有背景頁面，此時若把配方頁本身當成背景，
      // 從相關推薦切換配方就會在配方頁之間打轉而無法離開，因此改用首頁作為保底。
      const background = explicit ?? (isRecipePath(location.pathname) ? HOME_LOCATION : location);
      navigate(`/recipe/${recipe.id}`, { state: { background } });
    },
    [navigate, location],
  );
}

/**
 * 判斷路徑是否為配方詳情頁。
 *
 * @param pathname 目前的路徑
 */
function isRecipePath(pathname: string): boolean {
  return pathname.startsWith('/recipe/');
}
