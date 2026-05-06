"""
FeatureEnrichedEnv: StocksEnv wrapper that appends technical indicators to the observation.

Added features (normalized, appended to the base OHLCV window observation):
  - RSI(14)           : overbought/oversold signal, normalized to [0, 1]
  - MACD signal line  : trend momentum, normalized by current close price
  - Bollinger %B(20)  : position within volatility bands, normalized to [0, 1]
  - Volume z-score    : abnormal volume vs 20-day mean, clipped to [-3, 3] then scaled to [0, 1]

Observation shape: base_shape + (4,)  where base_shape = window_size * n_features (5 OHLCV cols)
"""

import numpy as np
import gymnasium as gym
from gymnasium import spaces
from gym_anytrading.envs import StocksEnv


WINDOW_SIZE = 20  # Must match the window_size used in StocksEnv constructor


def _rsi(close: np.ndarray, period: int = 14) -> float:
    """RSI of the last `period+1` close values, returned as a [0,1] float."""
    if len(close) < period + 1:
        return 0.5
    deltas = np.diff(close[-(period + 1):])
    gains = deltas[deltas > 0].mean() if (deltas > 0).any() else 0.0
    losses = -deltas[deltas < 0].mean() if (deltas < 0).any() else 0.0
    if losses == 0:
        return 1.0
    rs = gains / losses
    return rs / (1.0 + rs)


def _macd_signal(close: np.ndarray, fast: int = 12, slow: int = 26, signal: int = 9) -> float:
    """MACD signal line value normalized by current close price."""
    if len(close) < slow + signal:
        return 0.0
    def ema(arr, n):
        k = 2.0 / (n + 1)
        result = arr[0]
        for v in arr[1:]:
            result = v * k + result * (1 - k)
        return result
    macd_line = ema(close[-(slow + signal):-(signal)], fast) - ema(close[-(slow + signal):-(signal)], slow)
    # Approximate: just use final window
    fast_ema = ema(close[-(fast + signal):], fast)
    slow_ema = ema(close[-(slow + signal):], slow)
    macd = fast_ema - slow_ema
    current_price = close[-1] if close[-1] != 0 else 1.0
    return float(np.clip(macd / current_price, -0.05, 0.05) / 0.05)  # [-1, 1] → caller normalizes


def _bollinger_pct_b(close: np.ndarray, period: int = 20) -> float:
    """Bollinger Band %B: position within the band, normalized to [0, 1]."""
    if len(close) < period:
        return 0.5
    window = close[-period:]
    mean = window.mean()
    std = window.std()
    if std == 0:
        return 0.5
    upper = mean + 2 * std
    lower = mean - 2 * std
    pct_b = (close[-1] - lower) / (upper - lower)
    return float(np.clip(pct_b, 0.0, 1.0))


def _volume_zscore(volume: np.ndarray, period: int = 20) -> float:
    """Volume z-score clipped to [-3,3] and scaled to [0,1]."""
    if len(volume) < period + 1:
        return 0.5
    hist = volume[-(period + 1):-1]
    mean = hist.mean()
    std = hist.std()
    if std == 0:
        return 0.5
    z = (volume[-1] - mean) / std
    return float((np.clip(z, -3.0, 3.0) + 3.0) / 6.0)


def compute_indicators(df, idx: int) -> np.ndarray:
    """
    Compute the 4 technical indicators at position `idx` in the dataframe.
    Returns a float32 array of shape (4,).
    """
    close = df["Close"].values[:idx + 1].astype(np.float64)
    volume = df["Volume"].values[:idx + 1].astype(np.float64)

    rsi = _rsi(close)
    macd = (_macd_signal(close) + 1.0) / 2.0  # shift [-1,1] → [0,1]
    bb_pct_b = _bollinger_pct_b(close)
    vol_z = _volume_zscore(volume)

    return np.array([rsi, macd, bb_pct_b, vol_z], dtype=np.float32)


class FeatureEnrichedEnv(gym.Env):
    """
    Wraps gym_anytrading StocksEnv and appends 4 technical indicator features
    to each observation.  Drop-in replacement for GymnasiumWrapper in train.py,
    retrain.py and model_api.py.
    """

    def __init__(self, df, reward_fn=None):
        super().__init__()
        self._df = df
        self._reward_fn = reward_fn  # None in inference mode
        self.env = StocksEnv(df=df, window_size=WINDOW_SIZE, frame_bound=(WINDOW_SIZE, len(df)))
        self.action_space = self.env.action_space

        base_obs_space = self.env.observation_space
        n_base = int(np.prod(base_obs_space.shape))
        n_total = n_base + 4
        self.observation_space = spaces.Box(
            low=-np.inf, high=np.inf, shape=(n_total,), dtype=np.float32
        )
        self._current_step = WINDOW_SIZE  # tracks position in df for indicator computation

    def _enrich(self, obs: np.ndarray) -> np.ndarray:
        indicators = compute_indicators(self._df, self._current_step)
        flat_obs = obs.flatten().astype(np.float32)
        return np.concatenate([flat_obs, indicators])

    def reset(self, seed=None, options=None):
        raw = self.env.reset()
        obs = raw[0] if isinstance(raw, tuple) else raw
        self._current_step = WINDOW_SIZE
        return self._enrich(obs), {}

    def step(self, action):
        out = self.env.step(action)
        obs = out[0]
        raw_reward = float(out[1])
        terminated = out[2] if len(out) > 2 else False
        truncated = out[3] if len(out) > 3 else False
        info = out[4] if len(out) > 4 else {}
        self._current_step = min(self._current_step + 1, len(self._df) - 1)
        reward = self._reward_fn(raw_reward) if self._reward_fn is not None else raw_reward
        return self._enrich(obs), reward, terminated, truncated, info

    def render(self):
        return self.env.render()
