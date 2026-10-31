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
      const state = location.state as { background?: Location } | null;
      const background = state?.background ?? location;
      navigate(`/recipe/${recipe.id}`, { state: { background } });
    },
    [navigate, location],
  );
}
