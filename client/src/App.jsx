import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { useState } from 'react';
import HomePage from './pages/client/HomePage.jsx';
import ResultView from './pages/client/ResultView.jsx';
import LoginPage from './pages/admin/LoginPage.jsx';
import DashboardPage from './pages/admin/DashboardPage.jsx';
import PromptManagerPage from './pages/admin/PromptManagerPage.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';

export default function App() {
  const [language, setLanguage] = useState('vi');

  return (
    <>
      <header className="site-header">
        <Link className="brand" to="/" aria-label="Verity home">
          <span className="brand-icon" aria-hidden="true">V</span>
          <span className="brand-copy"><strong>Verity</strong><small>{language === 'vi' ? 'PHÒNG KIỂM CHỨNG SỐ' : 'DIGITAL VERIFICATION LAB'}</small></span>
        </Link>
        <button className="language-button" aria-label={language === 'vi' ? 'Switch to English' : 'Chuyển sang tiếng Việt'} onClick={() => setLanguage(language === 'vi' ? 'en' : 'vi')}>
          {language.toUpperCase()}
        </button>
      </header>
      <Routes>
        <Route path="/" element={<HomePage language={language} />} />
        <Route path="/result" element={<ResultView language={language} />} />
        <Route path="/admin/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/admin" element={<DashboardPage />} />
          <Route path="/admin/prompts" element={<PromptManagerPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
