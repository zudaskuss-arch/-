import AuthGate from "./AuthGate";
import VocabApp from "./VocabApp";

function App() {
  return (
    <AuthGate>
      <VocabApp />
    </AuthGate>
  );
}

export default App;
