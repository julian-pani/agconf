#!/usr/bin/env python3
"""
Validate that the python-structlog-datadog skill follows the Agent Skills specification.

Usage:
    python validate_skill.py
"""

import re
import sys
from pathlib import Path

# Colors for output
GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
RESET = "\033[0m"


def check_skill_md():
    """Validate SKILL.md format and content."""
    print("Checking SKILL.md...")
    skill_path = Path("SKILL.md")
    
    if not skill_path.exists():
        print(f"{RED}❌ SKILL.md not found{RESET}")
        return False
    
    content = skill_path.read_text()
    
    # Check for frontmatter
    if not content.startswith("---"):
        print(f"{RED}❌ SKILL.md must start with YAML frontmatter{RESET}")
        return False
    
    # Extract frontmatter
    parts = content.split("---", 2)
    if len(parts) < 3:
        print(f"{RED}❌ SKILL.md frontmatter not properly closed{RESET}")
        return False
    
    frontmatter = parts[1]
    body = parts[2]
    
    # Check required fields
    required_fields = ["name:", "description:"]
    for field in required_fields:
        if field not in frontmatter:
            print(f"{RED}❌ Missing required field: {field}{RESET}")
            return False
    
    # Validate name format
    name_match = re.search(r"name:\s*(.+)", frontmatter)
    if name_match:
        name = name_match.group(1).strip()
        # Check name constraints: 1-64 chars, lowercase alphanumeric and hyphens only
        if not re.match(r"^[a-z0-9-]{1,64}$", name):
            print(f"{RED}❌ Name '{name}' violates constraints (1-64 chars, lowercase alphanumeric and hyphens only){RESET}")
            return False
        if name.startswith("-") or name.endswith("-"):
            print(f"{RED}❌ Name '{name}' cannot start or end with hyphen{RESET}")
            return False
        if "--" in name:
            print(f"{RED}❌ Name '{name}' cannot contain consecutive hyphens{RESET}")
            return False
        print(f"{GREEN}✓ Name: {name}{RESET}")
    
    # Validate description
    desc_match = re.search(r"description:\s*(.+?)(?:\n[a-z-]+:|$)", frontmatter, re.DOTALL)
    if desc_match:
        description = desc_match.group(1).strip()
        if len(description) < 1 or len(description) > 1024:
            print(f"{RED}❌ Description must be 1-1024 characters{RESET}")
            return False
        print(f"{GREEN}✓ Description: {len(description)} chars{RESET}")
    
    # Check body content exists
    if len(body.strip()) < 100:
        print(f"{YELLOW}⚠️  Body content seems very short{RESET}")
    else:
        print(f"{GREEN}✓ Body content: {len(body)} chars{RESET}")
    
    print(f"{GREEN}✓ SKILL.md is valid{RESET}")
    return True


def check_directory_structure():
    """Validate directory structure."""
    print("\nChecking directory structure...")
    
    expected_files = [
        "SKILL.md",
        "README.md",
        "references/logging_config_template.py",
        "references/datadog_fields.md",
        "references/migration_examples.md",
        "references/fastapi_example.py",
        "references/temporal_example.py",
        "scripts/migrate_to_structlog.py",
    ]
    
    all_exist = True
    for filepath in expected_files:
        path = Path(filepath)
        if path.exists():
            print(f"{GREEN}✓ {filepath}{RESET}")
        else:
            print(f"{RED}❌ Missing: {filepath}{RESET}")
            all_exist = False
    
    if all_exist:
        print(f"{GREEN}✓ All expected files present{RESET}")
    
    return all_exist


def check_optional_directories():
    """Check optional directories are properly structured."""
    print("\nChecking optional directories...")
    
    references_path = Path("references")
    scripts_path = Path("scripts")
    
    if references_path.exists() and references_path.is_dir():
        ref_files = list(references_path.glob("*"))
        print(f"{GREEN}✓ references/ directory: {len(ref_files)} files{RESET}")
    else:
        print(f"{YELLOW}⚠️  references/ directory not found{RESET}")
    
    if scripts_path.exists() and scripts_path.is_dir():
        script_files = list(scripts_path.glob("*.py"))
        print(f"{GREEN}✓ scripts/ directory: {len(script_files)} scripts{RESET}")
    else:
        print(f"{YELLOW}⚠️  scripts/ directory not found{RESET}")
    
    return True


def check_file_sizes():
    """Check that files are reasonable sizes (progressive disclosure)."""
    print("\nChecking file sizes (progressive disclosure)...")
    
    skill_md = Path("SKILL.md")
    if skill_md.exists():
        size = skill_md.stat().st_size
        lines = len(skill_md.read_text().splitlines())
        
        if lines > 500:
            print(f"{YELLOW}⚠️  SKILL.md has {lines} lines (recommended: < 500){RESET}")
        else:
            print(f"{GREEN}✓ SKILL.md: {lines} lines{RESET}")
    
    return True


def main():
    print("=" * 60)
    print("Agent Skills Specification Validator")
    print("=" * 60)
    print()
    
    checks = [
        check_skill_md,
        check_directory_structure,
        check_optional_directories,
        check_file_sizes,
    ]
    
    results = []
    for check in checks:
        try:
            result = check()
            results.append(result)
        except Exception as e:
            print(f"{RED}❌ Check failed with error: {e}{RESET}")
            results.append(False)
        print()
    
    print("=" * 60)
    if all(results):
        print(f"{GREEN}✅ All checks passed!{RESET}")
        print("This skill follows the Agent Skills specification.")
        return 0
    else:
        print(f"{RED}❌ Some checks failed{RESET}")
        print("Please review the errors above and fix them.")
        return 1


if __name__ == "__main__":
    sys.exit(main())
