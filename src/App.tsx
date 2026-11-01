/**
 * 應用程式進入點與路由設定。
 *
 * 採 React Router 的「背景路由」模式：
 * 開啟配方抽屜時會 push 一筆 /recipe/:id 的網址紀錄，
 * 同時把原本頁面的 Location 存進路由 state，
 * 因此抽屜開啟時底下的頁面不會被卸載，關閉後也能回到原處。
 */
import { useCallback, useMemo } from 'react';
import {
  BrowserRouter,
  Link,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';
import type { Location } from 'react-router-dom';
import { Layout } from './components/Layout';
import { RecipeDrawer } from './components/RecipeDrawer';
import { useCocktails } from './hooks/useCocktails';
import { HOME_LOCATION } from './hooks/useRecipeNav';
import { Classic } from './pages/Classic';
import { Home } from './pages/Home';
import { Match } from './pages/Match';
import { Popular } from './pages/Popular';

/**
 * 配方抽屜的路由元件。
 */
function RecipeRoute() {
  const { id } = useParams();
  const { recipes, byId } = useCocktails();
  const navigate = useNavigate();
  const location = useLocation();

  const recipe = id ? (byId.get(id) ?? null) : null;

  const related = useMemo(() => {
    if (!recipe) return [];
    return recipes
      .filter((item) => item.category === recipe.category && item.id !== recipe.id)
      .slice(0, 4);
  }, [recipe, recipes]);

  const state = location.state as { background?: Location | null } | null;
  const background = state?.background;

  const handleClose = useCallback(() => {
    // 背景是保底的首頁（代表由深層連結直接開啟抽屜）時直接回首頁，
    // 其餘情況回到開啟抽屜前的頁面。
    if (background && background !== HOME_LOCATION) navigate(-1);
    else navigate('/', { replace: true });
  }, [background, navigate]);

  if (!recipe) return null;

  return <RecipeDrawer recipe={recipe} onClose={handleClose} related={related} />;
}

/**
 * 直接輸入 /recipe/:id（沒有背景頁面）時的底層畫面。
 *
 * 若配方編號不存在，就不會有任何抽屜開啟，此時改顯示 404 頁，
 * 避免使用者看到「配方詳情已在右側開啟」卻找不到抽屜。
 */
function RecipeBackdrop() {
  const { id } = useParams();
  const { byId } = useCocktails();

  if (id && !byId.has(id)) return <NotFound />;

  return (
    <div className="flex min-h-screen items-center justify-center px-6 text-center">
      <p className="text-sm text-ink-muted">配方詳情已在右側開啟，關閉後即可回到首頁。</p>
    </div>
  );
}

/**
 * 找不到對應頁面時的顯示。
 */
function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="neon-text font-display text-6xl font-black">404</p>
      <p className="text-sm text-ink-muted">這個頁面不存在，或配方編號有誤。</p>
      <Link
        to="/"
        className="rounded-full border border-neon-purple/60 bg-neon-purple/15 px-5 py-2 text-sm font-semibold text-ink transition hover:bg-neon-purple/25"
      >
        回到首頁
      </Link>
    </div>
  );
}

/**
 * 路由外層：依網址決定要渲染的頁面與抽屜。
 */
function Shell() {
  const location = useLocation();
  const state = location.state as { background?: Location } | null;
  const background = state?.background;

  return (
    <>
      {/* 主頁面：抽屜開啟時渲染背景頁面，保持底頁不被卸載 */}
      <Routes location={background ?? location}>
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          <Route path="/classic" element={<Classic />} />
          <Route path="/popular" element={<Popular />} />
          <Route path="/match" element={<Match />} />
          <Route path="/recipe/:id" element={<RecipeBackdrop />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>

      {/* 配方抽屜：獨立的路由層 */}
      <Routes>
        <Route path="/recipe/:id" element={<RecipeRoute />} />
      </Routes>
    </>
  );
}

/**
 * 應用程式根元件。
 */
export default function App() {
  return (
    <BrowserRouter>
      <Shell />
    </BrowserRouter>
  );
}
