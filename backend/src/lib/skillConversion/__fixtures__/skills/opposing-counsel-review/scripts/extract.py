#!/usr/bin/env python3
# Fixture only: a pretend upstream helper script. The converter must never
# ship this file. It is untrusted source data, not part of the fork.
import sys


def main() -> int:
    print("this script must be dropped by the converter")
    return 0


if __name__ == "__main__":
    sys.exit(main())
