import multiprocessing

if __name__ == "__main__":
    multiprocessing.freeze_support()
    from uzdesk.app import main
    main()
