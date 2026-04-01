"""
Model Manager: Utilities for model versioning, loading, saving, and performance tracking.
"""
import os
import json
import psycopg2
from stable_baselines3 import PPO
from typing import Optional, Dict, List, Tuple
from datetime import datetime
from dotenv import load_dotenv

# Load environment variables
_load_dirs = [
    os.path.join(os.path.dirname(__file__), ".."),
    os.path.dirname(__file__),
]
for _d in _load_dirs:
    _e = os.path.join(_d, ".env")
    if os.path.isfile(_e):
        load_dotenv(_e)
        break
else:
    load_dotenv()

# Sortino reward calculation (must match train.py)
DOWNSIDE_PENALTY_FACTOR = 2.0
DOWNSIDE_SQUARED = True
OPPORTUNITY_COST_PENALTY = -0.001  # Penalty for staying flat/in cash

def _sortino_reward(raw_reward: float) -> float:
    """Apply Sortino principle: heavy penalty for negative returns and opportunity cost for staying flat."""
    # Opportunity cost: penalize staying in cash (raw_reward === 0.0)
    if raw_reward == 0.0:
        return OPPORTUNITY_COST_PENALTY
    
    # Positive rewards unchanged
    if raw_reward > 0:
        return raw_reward
    
    # Negative rewards: apply downside penalty
    mag = abs(raw_reward)
    if DOWNSIDE_SQUARED:
        return -(DOWNSIDE_PENALTY_FACTOR * (mag ** 2))
    return raw_reward * DOWNSIDE_PENALTY_FACTOR


def _upside_reward(raw_reward: float) -> float:
    """Emphasize gains, punish losses less severely than Sortino (opposite philosophy)."""
    if raw_reward == 0.0:
        return OPPORTUNITY_COST_PENALTY
    if raw_reward > 0:
        # Amplify gains - convex: big wins rewarded more
        return raw_reward ** 1.2
    # Losses: linear (less severe than Sortino)
    return raw_reward


def get_reward_function(strategy: str):
    """Return the reward function for the given strategy."""
    if strategy == "upside":
        return _upside_reward
    return _sortino_reward


def get_db_connection(database_url: str):
    """Get database connection."""
    return psycopg2.connect(database_url)


def display_name_for_strategy(strategy: str, version_number: int) -> str:
    """UI/API display name: Sortino_Model_vX or Upside_Model_vX."""
    if strategy == "upside":
        return f"Upside_Model_v{version_number}"
    return f"Sortino_Model_v{version_number}"


def get_active_version_rows(database_url: str) -> Dict[str, Dict]:
    """
    Active model rows from DB for sortino and upside.
    Keys are 'sortino' and/or 'upside'. Empty dict if table/column missing or on error.
    Each value: version_number, model_path, display_name, created_at (ISO string or None).
    """
    conn = get_db_connection(database_url)
    try:
        cur = conn.cursor()
        try:
            cur.execute("""
                SELECT strategy, version_number, model_path, created_at
                FROM model_versions
                WHERE is_active = TRUE AND strategy IN ('sortino', 'upside')
            """)
            rows = cur.fetchall()
        except psycopg2.Error:
            cur.close()
            return {}
        cur.close()
        out: Dict[str, Dict] = {}
        for row in rows:
            strat, ver, path, created = row[0], row[1], row[2], row[3]
            if strat not in ("sortino", "upside"):
                continue
            out[strat] = {
                "version_number": int(ver),
                "model_path": path,
                "display_name": display_name_for_strategy(strat, int(ver)),
                "created_at": created.isoformat() if created else None,
            }
        return out
    except Exception as e:
        print(f"get_active_version_rows: {e}")
        return {}
    finally:
        conn.close()


def get_latest_model(database_url: str, model_dir: str = None, strategy: str = "sortino") -> Optional[PPO]:
    """
    Load the most recent active model version for the given strategy.
    
    Args:
        database_url: PostgreSQL connection string
        model_dir: Directory where models are stored (default: python_engine directory)
        strategy: 'sortino' or 'upside'
    
    Returns:
        PPO model instance or None if no model found
    """
    if model_dir is None:
        model_dir = os.path.dirname(__file__)
    
    conn = get_db_connection(database_url)
    try:
        cur = conn.cursor()
        try:
            cur.execute("""
                SELECT model_path, version_number
                FROM model_versions
                WHERE is_active = TRUE AND strategy = %s
                ORDER BY created_at DESC
                LIMIT 1
            """, (strategy,))
            row = cur.fetchone()
        except psycopg2.Error as e:
            # model_versions table or strategy column may not exist; fall back to default
            cur.close()
            default_path = os.path.join(model_dir, f"dow30_{strategy}_model.zip")
            if os.path.isfile(default_path):
                print(f"Loading default model from {default_path} (model_versions not available)")
                return PPO.load(default_path)
            # Legacy fallback for sortino
            if strategy == "sortino":
                legacy_path = os.path.join(model_dir, "dow30_model.zip")
                if os.path.isfile(legacy_path):
                    print(f"Loading legacy model from {legacy_path}")
                    return PPO.load(legacy_path)
            return None
        cur.close()

        if row:
            model_path, version = row
            full_path = os.path.join(model_dir, model_path) if not os.path.isabs(model_path) else model_path
            if os.path.isfile(full_path):
                print(f"Loading model version {version} ({strategy}) from {full_path}")
                return PPO.load(full_path)
            else:
                print(f"Warning: Model file not found: {full_path}")

        # Fallback: try default model path for strategy
        default_path = os.path.join(model_dir, f"dow30_{strategy}_model.zip")
        if os.path.isfile(default_path):
            print(f"Loading default model from {default_path}")
            return PPO.load(default_path)
        # Legacy fallback for sortino
        if strategy == "sortino":
            legacy_path = os.path.join(model_dir, "dow30_model.zip")
            if os.path.isfile(legacy_path):
                print(f"Loading legacy model from {legacy_path}")
                return PPO.load(legacy_path)

        return None
    finally:
        conn.close()


def save_model_version(
    model: PPO,
    database_url: str,
    model_dir: str = None,
    training_type: str = "online",
    total_experiences: int = 0,
    notes: str = None,
    strategy: str = "sortino"
) -> Optional[int]:
    """
    Save model with versioning and metadata.
    
    Args:
        model: PPO model instance
        database_url: PostgreSQL connection string
        model_dir: Directory to save models (default: python_engine directory)
        training_type: 'initial', 'online', or 'full_retrain'
        total_experiences: Number of experiences used in training
        notes: Optional notes about this version
        strategy: 'sortino' or 'upside'
    
    Returns:
        Version number if successful, None otherwise
    """
    if model is None:
        print("Error: Cannot save None model.")
        return None
    
    if model_dir is None:
        model_dir = os.path.dirname(__file__)
    
    conn = get_db_connection(database_url)
    try:
        cur = conn.cursor()
        
        # Get next version number (global across strategies)
        cur.execute("SELECT COALESCE(MAX(version_number), 0) + 1 FROM model_versions")
        version_number = cur.fetchone()[0]
        
        # Detect whether strategy column exists and whether old global unique index is present.
        cur.execute("""
            SELECT EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'model_versions'
                  AND column_name = 'strategy'
            )
        """)
        has_strategy_col = cur.fetchone()[0]
        cur.execute("""
            SELECT EXISTS (
                SELECT 1
                FROM pg_indexes
                WHERE schemaname = 'public'
                  AND indexname = 'idx_model_versions_active_unique'
            )
        """)
        has_global_active_unique = cur.fetchone()[0]

        # Deactivate previous active rows.
        # If old global unique index exists, deactivate all to avoid uniqueness conflicts.
        if has_global_active_unique:
            cur.execute("UPDATE model_versions SET is_active = FALSE")
        elif has_strategy_col:
            cur.execute("UPDATE model_versions SET is_active = FALSE WHERE strategy = %s", (strategy,))
        else:
            cur.execute("UPDATE model_versions SET is_active = FALSE")
        
        # Generate model filename (strategy-specific)
        model_filename = f"dow30_{strategy}_model_v{version_number}.zip"
        model_path = os.path.join(model_dir, model_filename)
        
        # Save model
        model.save(model_path)
        print(f"Saved model to {model_path}")
        
        # Calculate performance metrics
        metrics = get_model_performance(database_url, version_number - 1)  # Use previous version's trades
        
        # Insert new version record (with strategy only when the column exists)
        if has_strategy_col:
            cur.execute("""
                INSERT INTO model_versions 
                (version_number, model_path, training_type, total_experiences, 
                 win_rate, avg_pnl, sortino_ratio, total_trades, is_active, notes, strategy)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                version_number,
                model_filename,
                training_type,
                total_experiences,
                metrics.get('win_rate'),
                metrics.get('avg_pnl'),
                metrics.get('sortino_ratio'),
                metrics.get('total_trades'),
                True,
                notes,
                strategy
            ))
        else:
            cur.execute("""
                INSERT INTO model_versions 
                (version_number, model_path, training_type, total_experiences, 
                 win_rate, avg_pnl, sortino_ratio, total_trades, is_active, notes)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                version_number,
                model_filename,
                training_type,
                total_experiences,
                metrics.get('win_rate'),
                metrics.get('avg_pnl'),
                metrics.get('sortino_ratio'),
                metrics.get('total_trades'),
                True,
                notes
            ))
        
        conn.commit()
        cur.close()
        print(f"Model version {version_number} saved and activated")
        return version_number
    except Exception as e:
        conn.rollback()
        print(f"Error saving model version: {e}")
        return None
    finally:
        conn.close()


def get_model_performance(database_url: str, version_number: Optional[int] = None) -> Dict:
    """
    Calculate performance metrics for a model version.
    
    Args:
        database_url: PostgreSQL connection string
        version_number: Version to analyze (None = use latest)
    
    Returns:
        Dictionary with win_rate, avg_pnl, sortino_ratio, total_trades
    """
    conn = get_db_connection(database_url)
    try:
        cur = conn.cursor()
        
        # Get trades for this version (or all trades if version not specified)
        if version_number:
            # Get timestamp range for this version
            cur.execute("""
                SELECT created_at 
                FROM model_versions 
                WHERE version_number = %s
            """, (version_number,))
            version_row = cur.fetchone()
            if version_row:
                version_time = version_row[0]
                # Get trades after this version was created
                cur.execute("""
                    SELECT pnl 
                    FROM trades 
                    WHERE timestamp >= %s AND pnl IS NOT NULL AND pnl != 0
                """, (version_time,))
            else:
                cur.execute("SELECT pnl FROM trades WHERE pnl IS NOT NULL AND pnl != 0")
        else:
            # Get all completed trades
            cur.execute("""
                SELECT pnl 
                FROM trades 
                WHERE pnl IS NOT NULL AND pnl != 0
            """)
        
        rows = cur.fetchall()
        cur.close()
        
        if not rows:
            return {
                'win_rate': 0.0,
                'avg_pnl': 0.0,
                'sortino_ratio': 0.0,
                'total_trades': 0
            }
        
        pnls = [float(row[0]) for row in rows]
        total_trades = len(pnls)
        wins = sum(1 for pnl in pnls if pnl > 0)
        win_rate = (wins / total_trades * 100) if total_trades > 0 else 0.0
        avg_pnl = sum(pnls) / total_trades if total_trades > 0 else 0.0
        
        # Calculate Sortino ratio (simplified: mean return / downside deviation)
        returns = pnls  # Using PNL as proxy for returns
        negative_returns = [r for r in returns if r < 0]
        if len(negative_returns) > 0:
            downside_dev = (sum(r**2 for r in negative_returns) / len(negative_returns)) ** 0.5
            sortino_ratio = avg_pnl / downside_dev if downside_dev > 0 else 0.0
        else:
            sortino_ratio = avg_pnl if avg_pnl > 0 else 0.0
        
        return {
            'win_rate': round(win_rate, 2),
            'avg_pnl': round(avg_pnl, 4),
            'sortino_ratio': round(sortino_ratio, 4),
            'total_trades': total_trades
        }
    except Exception as e:
        print(f"Error calculating performance: {e}")
        return {
            'win_rate': 0.0,
            'avg_pnl': 0.0,
            'sortino_ratio': 0.0,
            'total_trades': 0
        }
    finally:
        conn.close()


def list_model_versions(database_url: str) -> List[Dict]:
    """
    List all model versions with their metadata.
    
    Args:
        database_url: PostgreSQL connection string
    
    Returns:
        List of dictionaries with version information
    """
    conn = get_db_connection(database_url)
    try:
        cur = conn.cursor()
        try:
            cur.execute("""
                SELECT 
                    id, version_number, model_path, created_at, training_type,
                    total_experiences, win_rate, avg_pnl, sortino_ratio, 
                    total_trades, is_active, notes, strategy
                FROM model_versions
                ORDER BY created_at DESC
            """)
            rows = cur.fetchall()
            has_strategy = True
        except psycopg2.Error:
            conn.rollback()
            cur.close()
            cur = conn.cursor()
            cur.execute("""
                SELECT 
                    id, version_number, model_path, created_at, training_type,
                    total_experiences, win_rate, avg_pnl, sortino_ratio, 
                    total_trades, is_active, notes
                FROM model_versions
                ORDER BY created_at DESC
            """)
            rows = cur.fetchall()
            has_strategy = False
        cur.close()
        
        versions = []
        for row in rows:
            base = {
                'id': row[0],
                'version_number': row[1],
                'model_path': row[2],
                'created_at': row[3].isoformat() if row[3] else None,
                'training_type': row[4],
                'total_experiences': row[5],
                'win_rate': float(row[6]) if row[6] else None,
                'avg_pnl': float(row[7]) if row[7] else None,
                'sortino_ratio': float(row[8]) if row[8] else None,
                'total_trades': row[9],
                'is_active': row[10],
                'notes': row[11]
            }
            if has_strategy:
                strat = row[12]
                base['strategy'] = strat if strat else 'sortino'
            else:
                base['strategy'] = 'sortino'
            versions.append(base)
        return versions
    except Exception as e:
        print(f"Error listing model versions: {e}")
        return []
    finally:
        conn.close()


def rollback_model(database_url: str, version_number: int) -> bool:
    """
    Rollback to a previous model version.
    
    Args:
        database_url: PostgreSQL connection string
        version_number: Version number to rollback to
    
    Returns:
        True if successful, False otherwise
    """
    conn = get_db_connection(database_url)
    try:
        cur = conn.cursor()
        
        # Check if version exists
        cur.execute("""
            SELECT id FROM model_versions WHERE version_number = %s
        """, (version_number,))
        if not cur.fetchone():
            print(f"Version {version_number} not found")
            return False
        
        # Deactivate all versions
        cur.execute("UPDATE model_versions SET is_active = FALSE")
        
        # Activate specified version
        cur.execute("""
            UPDATE model_versions 
            SET is_active = TRUE 
            WHERE version_number = %s
        """, (version_number,))
        
        conn.commit()
        cur.close()
        print(f"Rolled back to model version {version_number}")
        return True
    except Exception as e:
        conn.rollback()
        print(f"Error rolling back model: {e}")
        return False
    finally:
        conn.close()
