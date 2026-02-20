import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { DashboardPage } from '@/pages/DashboardPage';
import { ThankYouPage } from '@/pages/ThankYouPage';
import { MobileMenuPage } from '@/pages/MobileMenuPage';
import { Toaster } from '@/components/ui/sonner';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/thank-you" element={<ThankYouPage />} />
        <Route path="/menu" element={<MobileMenuPage />} />
      </Routes>
      <Toaster />
    </Router>
  );
}

export default App;
