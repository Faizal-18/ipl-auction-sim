import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import Lobby from './pages/Lobby';
import Auction from './pages/Auction';
import Results from './pages/Results';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/room/:roomId" element={<Lobby />} />
        <Route path="/room/:roomId/auction" element={<Auction />} />
        <Route path="/room/:roomId/results" element={<Results />} />
      </Routes>
    </Router>
  );
}

export default App;
