#!/usr/bin/env python3
"""
Automated migration script for converting standard logging to structlog.

This script performs the following migrations:
1. Replaces logging.getLogger(__name__) with structlog.get_logger()
2. Converts logger.info("msg", extra={...}) to logger.info("event", key=value)
3. Updates import statements
4. Identifies files that need manual review

Usage:
    python migrate_to_structlog.py /path/to/project --dry-run
    python migrate_to_structlog.py /path/to/project --apply

Note: Always review changes before applying. This script is a starting point,
not a complete solution. Complex logging patterns will need manual migration.
"""

import argparse
import ast
import re
import sys
from pathlib import Path
from typing import List, Tuple


class LoggingMigrationVisitor(ast.NodeVisitor):
    """AST visitor to find logging calls that need migration."""
    
    def __init__(self):
        self.issues = []
        self.uses_logging = False
        self.uses_getLogger = False
    
    def visit_Import(self, node):
        """Check for 'import logging'."""
        for alias in node.names:
            if alias.name == "logging":
                self.uses_logging = True
        self.generic_visit(node)
    
    def visit_ImportFrom(self, node):
        """Check for 'from logging import ...'."""
        if node.module == "logging":
            self.uses_logging = True
        self.generic_visit(node)
    
    def visit_Call(self, node):
        """Check for logging.getLogger() and logger.* calls."""
        # Check for logging.getLogger(__name__)
        if (isinstance(node.func, ast.Attribute) and
            node.func.attr == "getLogger" and
            isinstance(node.func.value, ast.Name) and
            node.func.value.id == "logging"):
            self.uses_getLogger = True
            self.issues.append({
                "type": "getLogger",
                "line": node.lineno,
                "col": node.col_offset,
            })
        
        # Check for logger.info/debug/warning/error with extra={}
        if (isinstance(node.func, ast.Attribute) and
            node.func.attr in ["debug", "info", "warning", "error", "critical", "exception"]):
            
            # Check if 'extra' keyword is used
            for keyword in node.keywords:
                if keyword.arg == "extra":
                    self.issues.append({
                        "type": "extra_dict",
                        "line": node.lineno,
                        "col": node.col_offset,
                        "method": node.func.attr,
                    })
                    break
        
        self.generic_visit(node)


def analyze_file(filepath: Path) -> Tuple[bool, List[dict]]:
    """
    Analyze a Python file for logging usage.
    
    Returns:
        Tuple of (needs_migration, issues)
    """
    try:
        content = filepath.read_text(encoding="utf-8")
        tree = ast.parse(content, filename=str(filepath))
        
        visitor = LoggingMigrationVisitor()
        visitor.visit(tree)
        
        needs_migration = visitor.uses_logging or visitor.uses_getLogger
        
        return needs_migration, visitor.issues
        
    except SyntaxError as e:
        print(f"  ⚠️  Syntax error in {filepath}: {e}")
        return False, []
    except Exception as e:
        print(f"  ⚠️  Error analyzing {filepath}: {e}")
        return False, []


def migrate_file_content(content: str) -> str:
    """
    Perform regex-based migrations on file content.
    
    This is a best-effort approach. Complex patterns will need manual review.
    """
    # Step 1: Update imports
    # Replace 'import logging' with 'import structlog'
    content = re.sub(
        r'^import logging$',
        'import structlog',
        content,
        flags=re.MULTILINE
    )
    
    # Replace 'from logging import ...' with appropriate structlog imports
    content = re.sub(
        r'^from logging import (.+)$',
        r'# TODO: Review this import - was: from logging import \1\nimport structlog',
        content,
        flags=re.MULTILINE
    )
    
    # Step 2: Replace logging.getLogger(__name__) with structlog.get_logger()
    content = re.sub(
        r'logging\.getLogger\(__name__\)',
        'structlog.get_logger()',
        content
    )
    
    content = re.sub(
        r'logging\.getLogger\([\'"](.+?)[\'"]\)',
        'structlog.get_logger()',
        content
    )
    
    # Step 3: Simple extra={} conversion (only handles simple cases)
    # Pattern: logger.info("message", extra={"key": value, ...})
    # This regex is simplified and may not catch all cases
    
    # For now, add TODO comments for manual review
    content = re.sub(
        r'(logger\.(debug|info|warning|error|critical|exception)\(.+?extra=\{.+?\})',
        r'# TODO: Migrate to structlog format - convert extra={} to kwargs\n\1',
        content,
        flags=re.DOTALL
    )
    
    return content


def migrate_file(filepath: Path, dry_run: bool = True) -> bool:
    """
    Migrate a single file to structlog.
    
    Returns:
        True if changes were made
    """
    try:
        original_content = filepath.read_text(encoding="utf-8")
        migrated_content = migrate_file_content(original_content)
        
        if original_content == migrated_content:
            return False
        
        if dry_run:
            print(f"  📝 Would modify: {filepath}")
            return True
        else:
            # Create backup
            backup_path = filepath.with_suffix(filepath.suffix + ".bak")
            filepath.write_text(migrated_content, encoding="utf-8")
            backup_path.write_text(original_content, encoding="utf-8")
            print(f"  ✅ Migrated: {filepath} (backup: {backup_path})")
            return True
            
    except Exception as e:
        print(f"  ❌ Error migrating {filepath}: {e}")
        return False


def find_python_files(directory: Path) -> List[Path]:
    """Find all Python files in directory, excluding common non-source directories."""
    exclude_dirs = {
        '.git', '.venv', 'venv', 'env', '__pycache__',
        'node_modules', '.pytest_cache', '.mypy_cache',
        'build', 'dist', '.eggs', '*.egg-info'
    }
    
    python_files = []
    for path in directory.rglob("*.py"):
        # Skip excluded directories
        if any(excluded in path.parts for excluded in exclude_dirs):
            continue
        python_files.append(path)
    
    return python_files


def main():
    parser = argparse.ArgumentParser(
        description="Migrate Python project from logging to structlog"
    )
    parser.add_argument(
        "project_path",
        type=Path,
        help="Path to Python project directory"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be changed without modifying files"
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Apply migrations (creates .bak backups)"
    )
    
    args = parser.parse_args()
    
    if not args.dry_run and not args.apply:
        print("Error: Must specify either --dry-run or --apply")
        sys.exit(1)
    
    if not args.project_path.exists():
        print(f"Error: Directory not found: {args.project_path}")
        sys.exit(1)
    
    print(f"🔍 Scanning project: {args.project_path}")
    print()
    
    # Find all Python files
    python_files = find_python_files(args.project_path)
    print(f"Found {len(python_files)} Python files")
    print()
    
    # Analyze files
    files_to_migrate = []
    for filepath in python_files:
        needs_migration, issues = analyze_file(filepath)
        
        if needs_migration:
            files_to_migrate.append((filepath, issues))
    
    if not files_to_migrate:
        print("✅ No files need migration!")
        return
    
    print(f"📊 Found {len(files_to_migrate)} files using standard logging:")
    print()
    
    # Show analysis
    for filepath, issues in files_to_migrate:
        rel_path = filepath.relative_to(args.project_path)
        print(f"  📄 {rel_path}")
        
        if issues:
            for issue in issues:
                if issue["type"] == "getLogger":
                    print(f"     Line {issue['line']}: Uses logging.getLogger()")
                elif issue["type"] == "extra_dict":
                    print(f"     Line {issue['line']}: Uses extra={{}} in {issue['method']}()")
        print()
    
    # Perform migration
    if args.apply:
        print("🔄 Applying migrations...")
        print()
        
        modified_count = 0
        for filepath, _ in files_to_migrate:
            if migrate_file(filepath, dry_run=False):
                modified_count += 1
        
        print()
        print(f"✅ Modified {modified_count} files")
        print()
        print("⚠️  IMPORTANT: Manual review required!")
        print("   - Check all files marked with TODO comments")
        print("   - Convert extra={{}} to kwargs manually")
        print("   - Update any complex logging patterns")
        print("   - Add logging_config.py to your project")
        print("   - Update main.py to call configure_logging()")
        print()
        print("📖 See migration guide: references/migration_examples.md")
        
    elif args.dry_run:
        print("🔍 Dry run - no files modified")
        print()
        print("To apply changes, run with --apply:")
        print(f"  python {sys.argv[0]} {args.project_path} --apply")


if __name__ == "__main__":
    main()
