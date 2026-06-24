// App.jsx
// Ejemplo de cómo conectar las rutas /setup y /admin/qr-generator
// usando react-router-dom, según tu estructura de carpetas:
//   src/pages/DeviceSetupPage.jsx
//   src/admin/QrGenerator.jsx

import { BrowserRouter, Routes, Route } from "react-router-dom";
import DeviceSetupPage from "./pages/DeviceSetupPage";
import QrGenerator from "./admin/QrGenerator";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Por ahora "/" redirige directo a la página de setup, ya que el
            proyecto es solo para esto. Cuando tengas más cosas en la app,
            aquí agregas más <Route> y cambias "/" por tu home real. */}
        <Route path="/" element={<DeviceSetupPage />} />
        <Route path="/setup" element={<DeviceSetupPage />} />
        <Route path="/admin/qr-generator" element={<QrGenerator />} />
      </Routes>
    </BrowserRouter>
  );
}
