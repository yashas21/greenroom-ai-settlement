import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { Sidebar } from "@/components/layout/sidebar";
import { CommandPaletteData } from "@/components/command-palette/command-data";
import ShowsPage from "@/pages/shows";
import ShowDetailPage from "@/pages/show-detail";
import SettlePage from "@/pages/settle";
import ArtistsPage from "@/pages/artists";
import ArtistDetailPage from "@/pages/artist-detail";
import ReportsPage from "@/pages/reports";
import DealAnalysisPage from "@/pages/deal-analysis";
import NeedsAttentionPage from "@/pages/needs-attention";
import InsightsPage from "@/pages/insights";
import SettingsPage from "@/pages/settings";
import ContextPage from "@/pages/context";
import NotFound from "@/pages/not-found";

function AppRoutes() {
  return (
    <Switch>
      <Route path="/"><Redirect to="/shows" /></Route>
      <Route path="/shows" component={ShowsPage} />
      <Route path="/shows/:id/settle" component={SettlePage} />
      <Route path="/shows/:id" component={ShowDetailPage} />
      <Route path="/artists" component={ArtistsPage} />
      <Route path="/artists/:id" component={ArtistDetailPage} />
      <Route path="/reports" component={ReportsPage} />
      <Route path="/deal-analysis" component={DealAnalysisPage} />
      <Route path="/needs-attention" component={NeedsAttentionPage} />
      <Route path="/insights" component={InsightsPage} />
      <Route path="/settings" component={SettingsPage} />
      <Route path="/context" component={ContextPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <Sidebar />
      <main className="flex-1 overflow-auto relative">
        <AppRoutes />
      </main>
      <CommandPaletteData />
    </WouterRouter>
  );
}

export default App;
