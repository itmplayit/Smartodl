import { BrowserRouter } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider } from './context/AuthContext';
import { SettingsProvider } from './context/SettingsContext';
import { ToastProvider } from './context/ToastContext';
import { LangProvider } from './context/LangContext';
import AppRoutes from './routes/AppRoutes';
import ScrollToTop from './components/ScrollToTop';
import ConnectionStatus from './components/ConnectionStatus';
import PermissionWatcher from './components/PermissionWatcher';
import PrintScreenGuard from './components/PrintScreenGuard';
import RouteMeta from './components/RouteMeta';

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <ToastProvider>
          <SettingsProvider>
            <LangProvider>
              <AuthProvider>
                <ScrollToTop />
                <RouteMeta />
                <ConnectionStatus />
                <PermissionWatcher />
                <PrintScreenGuard />
                <AppRoutes />
              </AuthProvider>
            </LangProvider>
          </SettingsProvider>
        </ToastProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
