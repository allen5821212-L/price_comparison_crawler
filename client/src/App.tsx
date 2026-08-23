import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { PriceAlertListener } from "./components/PriceAlertListener";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import RulesManagement from "./pages/RulesManagement";
import CrawlerMonitor from "./pages/CrawlerMonitor";
import FavoritesPage from "./pages/FavoritesPage";
import CoolpcCoveragePage from "./pages/CoolpcCoveragePage";
import CoolpcOnlyPage from "./pages/CoolpcOnlyPage";
import ComparisonListPage from "./pages/ComparisonListPage";

function Router() {
  // make sure to consider if you need authentication for certain routes
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/comparisons"} component={ComparisonListPage} />
      <Route path={"/rules"} component={RulesManagement} />
      <Route path={"/crawler"} component={CrawlerMonitor} />
      <Route path={"/favorites"} component={FavoritesPage} />
      <Route path={"/coverage"} component={CoolpcCoveragePage} />
      <Route path={"/coolpc-only"} component={CoolpcOnlyPage} />
      <Route path={"/404"} component={NotFound} />
      {/* Final fallback route */}
      <Route component={NotFound} />
    </Switch>
  );
}

// NOTE: About Theme
// - First choose a default theme according to your design style (dark or light bg), than change color palette in index.css
//   to keep consistent foreground/background color across components
// - If you want to make theme switchable, pass `switchable` ThemeProvider and use `useTheme` hook

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider
        defaultTheme="dark"
        switchable
      >
        <TooltipProvider>
          <Toaster />
          <PriceAlertListener />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
