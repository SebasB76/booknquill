import { Component, type ReactNode } from "react";

type Props = { active: boolean; children: ReactNode };

/** Keeps an editor failure inside its tab; without it React blanks the whole window. */
export class EditorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="doc editor-error" hidden={!this.props.active} role="alert">
        <p>Esta nota no se pudo mostrar. El archivo no cambió.</p>
        <p className="meta">{this.state.error.message}</p>
        <button className="row" onClick={() => this.setState({ error: null })}>Reintentar</button>
      </div>
    );
  }
}
