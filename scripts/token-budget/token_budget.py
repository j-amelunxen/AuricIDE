#!/usr/bin/env python3
"""Entry point: python3 scripts/token-budget/token_budget.py --out DIR [--since D] [--until D] [--project P] [--paths]"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tokenbudget.cli import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main())
