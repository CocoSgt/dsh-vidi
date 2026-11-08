import { Component, type ReactNode } from 'react'

/**
 * Keeps a companion plugin's part of the page (a tab, a player menu, a
 * workbench) from taking the whole video page down: if it fails, only its
 * own area says so, with a way out, and the video keeps playing.
 */
export class Guard extends Component<{ name: string; message: string; onClose?: () => void; closeLabel?: string; children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {}
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error) { console.error(`[dsh-vidi] ${this.props.name} failed`, error) }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="dshl-guard" role="alert">
        <p>{this.props.message}</p>
        <code>{this.state.error.message}</code>
        <div>
          <button className="dshl-btn small" onClick={() => this.setState({ error: undefined })}>↻</button>
          {this.props.onClose && <button className="dshl-btn small" onClick={this.props.onClose}>{this.props.closeLabel}</button>}
        </div>
      </div>
    )
  }
}
