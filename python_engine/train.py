
import yfinance as yf
import gym
import gym_anytrading
from gym_anytrading.envs import StocksEnv
from stable_baselines3 import PPO
from stable_baselines3.common.vec_env import DummyVecEnv

def train_model():
    print("Downloading historical data for AAPL...")
    df = yf.download('AAPL', start='2020-01-01', end='2024-01-01')
    
    # gym-anytrading expects 'Open', 'High', 'Low', 'Close', 'Volume' columns
    # yfinance returns them correctly, but sometimes needs minor renaming if multi-indexed
    
    # Create the environment
    env_id = 'stocks-v0'
    env = gym.make(env_id, df=df, frame_bound=(10, len(df)), window_size=10)
    
    # Wrap environment
    env = DummyVecEnv([lambda: env])
    
    # Initialize PPO Agent
    print("Initializing PPO Agent...")
    model = PPO('MlpPolicy', env, verbose=1, tensorboard_log="./ppo_stocks_tensorboard/")
    
    # Train
    print("Starting training...")
    model.learn(total_timesteps=50000)
    
    # Save
    model_path = "aapl_model.zip"
    model.save(model_path)
    print(f"Model saved to {model_path}")

if __name__ == "__main__":
    train_model()
